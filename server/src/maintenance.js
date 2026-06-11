import { db, now } from './db.js';
import { purgeExpiredMessages } from './chatRepo.js';
import { purgeExpiredStatuses } from './statusRepo.js';
import { broadcastToChat } from './hub.js';

// Periodic housekeeping that keeps the database lean and makes disappearing
// messages actually disappear:
//   • purge messages whose per-chat timer ran out (+ tell live clients),
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
  purgeExpiredStatuses();
  // Expired OTP rows are useless after their window; keep an hour of slack for
  // debugging ("why didn't my code work?") before dropping them.
  staleCodes.run(now() - 60 * 60 * 1000);
  return { purgedMessages: purged.length };
}

/** Start the recurring sweep (every minute). Returns a stop function. */
export function startMaintenance(intervalMs = 60_000) {
  const timer = setInterval(() => {
    try {
      runMaintenance();
    } catch (e) {
      console.error('[maintenance] Lauf fehlgeschlagen:', e.message);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
