import { db, now } from './db.js';
import { purgeExpiredMessages, getChat } from './chatRepo.js';
import { purgeExpiredStatuses } from './statusRepo.js';
import { broadcastToChat, sendToUser } from './hub.js';
import { sendPushToUsers } from './push.js';
import { dueScheduled, deleteScheduled } from './scheduledRepo.js';
import {
  dueReminders,
  markReminderFired,
  purgeFiredReminders,
  reminderView,
} from './remindersRepo.js';
import {
  dueScheduledBroadcasts,
  deleteScheduledBroadcast,
} from './scheduledBroadcastRepo.js';
import { purgeAutoReplies } from './focusRepo.js';
import {
  dueEventReminders,
  markEventReminded,
  eventView,
} from './eventsRepo.js';
import { trimSecurityEvents } from './securityRepo.js';
import { dispatchBroadcast } from './broadcast.js';
import { deliverMessage } from './deliver.js';

// Periodic housekeeping that keeps the database lean and makes disappearing
// messages actually disappear:
//   • purge messages whose per-chat timer ran out (+ tell live clients),
//   • deliver "send later" messages that have come due,
//   • drop expired status updates (they're already invisible, this frees rows),
//   • drop stale one-time SMS codes.
// Everything in one sweep so there is a single timer to reason about.

const staleCodes = db.prepare('DELETE FROM phone_codes WHERE expires_at <= ?');

/** One housekeeping pass. Exported so tests can trigger it synchronously. */
export function runMaintenance() {
  // Disappearing messages: remove and notify each chat so open clients drop
  // the bubble immediately (closed clients reconcile on the next history load).
  const purged = purgeExpiredMessages();
  for (const row of purged) {
    broadcastToChat(row.chat_id, 'message-purged', {
      chatId: row.chat_id,
      messageId: row.id,
    });
  }
  // Scheduled ("send later") messages that have come due → deliver them now.
  let delivered = 0;
  for (const row of dueScheduled()) {
    try {
      const chat = getChat(row.chat_id);
      // Drop silently if the chat or sender vanished, or the channel got locked.
      if (chat && !chat.locked) {
        deliverMessage(chat, {
          senderId: row.sender_id,
          type: row.type,
          body: row.body,
          attachment: row.attachment ? JSON.parse(row.attachment) : null,
          replyTo: row.reply_to,
        });
        delivered++;
      }
      deleteScheduled(row.id);
    } catch (e) {
      console.error('[maintenance] geplante Nachricht fehlgeschlagen:', e.message);
      deleteScheduled(row.id); // don't let one bad row wedge the queue
    }
  }
  // Scheduled broadcasts that have come due → send them like a manual broadcast.
  // Delete first so a transient push failure can't replay the same broadcast on
  // the next sweep (the live announcement already went out).
  let sentBroadcasts = 0;
  for (const row of dueScheduledBroadcasts()) {
    deleteScheduledBroadcast(row.id);
    dispatchBroadcast({ title: row.title, body: row.body, route: row.route || undefined })
      .then(() => {})
      .catch((e) => console.error('[maintenance] geplante Durchsage fehlgeschlagen:', e.message));
    sentBroadcasts++;
  }
  // Message reminders ("Erinnere mich") that have come due → nudge the owner
  // over their live sockets and, as a fallback, via push. Stamp fired_at first so
  // a push failure can never re-fire the same reminder on the next sweep.
  let firedReminders = 0;
  for (const row of dueReminders()) {
    try {
      markReminderFired(row.id);
      const reminder = reminderView(row);
      sendToUser(row.user_id, 'reminder', { reminder });
      const where = reminder.chatTitle ? ` · ${reminder.chatTitle}` : '';
      sendPushToUsers([row.user_id], {
        title: '⏰ Erinnerung',
        body: (reminder.note || reminder.preview || 'Du wolltest an etwas erinnert werden.') + where,
        data: {
          type: 'reminder',
          reminderId: reminder.id,
          chatId: reminder.chatId,
          messageId: reminder.messageId,
        },
      }).catch(() => {});
      firedReminders++;
    } catch (e) {
      console.error('[maintenance] Erinnerung fehlgeschlagen:', e.message);
    }
  }
  // Drop reminders that fired long enough ago that the user has seen them.
  purgeFiredReminders();
  // 0.33.0 "Pläne & Aufgaben": event ("Termin") reminders that have come due →
  // nudge everyone who said "going"/"maybe" (plus the creator) over their live
  // sockets and via push. Stamp reminded_at first so a push failure can't replay
  // the same reminder on the next sweep.
  let firedEvents = 0;
  for (const row of dueEventReminders()) {
    try {
      markEventReminded(row.id);
      const event = eventView(row.message_id, row.creator_id);
      if (!event) continue;
      const targets = new Set([row.creator_id]);
      for (const a of event.attendees || []) targets.add(a.userId);
      const chat = getChat(row.chat_id);
      const where = chat?.name ? ` · ${chat.name}` : '';
      const when = new Date(event.startAt).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      });
      for (const userId of targets) {
        sendToUser(userId, 'event-reminder', {
          event: { ...event, chatId: row.chat_id, messageId: row.message_id },
        });
      }
      sendPushToUsers([...targets], {
        title: `📅 ${event.title}`,
        body: `Beginnt um ${when}${where}`,
        data: { type: 'event', chatId: row.chat_id, messageId: row.message_id },
      }).catch(() => {});
      firedEvents++;
    } catch (e) {
      console.error('[maintenance] Termin-Erinnerung fehlgeschlagen:', e.message);
    }
  }
  // 0.30.0: drop stale focus auto-reply throttle rows (older than the cool-down).
  purgeAutoReplies();
  purgeExpiredStatuses();
  // Expired OTP rows are useless after their window; keep an hour of slack for
  // debugging ("why didn't my code work?") before dropping them.
  staleCodes.run(now() - 60 * 60 * 1000);
  return {
    purgedMessages: purged.length,
    deliveredScheduled: delivered,
    sentBroadcasts,
    firedReminders,
    firedEvents,
  };
}

/**
 * Keep the on-disk database tidy: refresh SQLite's query-planner statistics and
 * fold the write-ahead log back into the main file so it can't grow unbounded
 * between backups. Cheap enough to run on a slow cadence; never throws.
 */
export function optimizeDatabase() {
  try {
    // Keep each user's security feed to its newest 100 rows so it can't grow
    // without bound (cheap; runs on the slow optimisation cadence).
    trimSecurityEvents(100);
    db.exec('PRAGMA optimize;');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {
    console.error('[maintenance] DB-Optimierung fehlgeschlagen:', e.message);
  }
}

/**
 * Start the recurring sweeps. The frequent one (every minute) handles
 * disappearing/scheduled messages; a slower one keeps the database lean.
 * Returns a stop function.
 */
export function startMaintenance(intervalMs = 60_000, optimizeMs = 60 * 60_000) {
  const timer = setInterval(() => {
    try {
      runMaintenance();
    } catch (e) {
      console.error('[maintenance] Lauf fehlgeschlagen:', e.message);
    }
  }, intervalMs);
  timer.unref();

  const optimizeTimer = setInterval(optimizeDatabase, optimizeMs);
  optimizeTimer.unref();

  return () => {
    clearInterval(timer);
    clearInterval(optimizeTimer);
  };
}
