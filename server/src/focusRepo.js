import { db, now } from './db.js';

// 0.30.0 "Finden & Fokus": per-user notification controls (focus mode + quiet
// hours + DM auto-reply). The single source of truth for "should this user be
// spared a push right now?" lives here so the push path (push.js / deliver.js)
// and the route layer agree exactly.
//
// Quiet hours are stored as minutes-of-day in the *server's* local timezone with
// a 7-bit day mask (bit 0 = Monday … bit 6 = Sunday). A single host serving one
// region (this deployment is Austria/CET) makes server-local the pragmatic,
// surprise-free choice; the client renders the same wall-clock the user picked.

const DEFAULTS = {
  focusUntil: 0,
  quietEnabled: false,
  quietStart: 1320, // 22:00
  quietEnd: 420, //    07:00
  quietDays: 127, //   every day
  autoReply: '',
  updatedAt: 0,
};

const s = {
  get: db.prepare('SELECT * FROM user_focus WHERE user_id = ?'),
  upsert: db.prepare(`
    INSERT INTO user_focus
      (user_id, focus_until, quiet_enabled, quiet_start, quiet_end, quiet_days, auto_reply, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      focus_until   = excluded.focus_until,
      quiet_enabled = excluded.quiet_enabled,
      quiet_start   = excluded.quiet_start,
      quiet_end     = excluded.quiet_end,
      quiet_days    = excluded.quiet_days,
      auto_reply    = excluded.auto_reply,
      updated_at    = excluded.updated_at`),
  arGet: db.prepare('SELECT sent_at FROM focus_autoreplies WHERE user_id = ? AND peer_id = ?'),
  arSet: db.prepare(`
    INSERT INTO focus_autoreplies (user_id, peer_id, sent_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id, peer_id) DO UPDATE SET sent_at = excluded.sent_at`),
  arPurge: db.prepare('DELETE FROM focus_autoreplies WHERE sent_at <= ?'),
};

function rowToSettings(row) {
  if (!row) return { ...DEFAULTS };
  return {
    focusUntil: row.focus_until || 0,
    quietEnabled: !!row.quiet_enabled,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    quietDays: row.quiet_days,
    autoReply: row.auto_reply || '',
    updatedAt: row.updated_at || 0,
  };
}

/** The signed-in user's focus settings (defaults when never configured). */
export function getFocus(userId) {
  return rowToSettings(s.get.get(userId));
}

/** Merge a validated patch into the user's focus settings; returns the result. */
export function setFocus(userId, patch = {}) {
  const cur = getFocus(userId);
  const next = {
    focusUntil: patch.focusUntil !== undefined ? patch.focusUntil : cur.focusUntil,
    quietEnabled: patch.quietEnabled !== undefined ? patch.quietEnabled : cur.quietEnabled,
    quietStart: patch.quietStart !== undefined ? patch.quietStart : cur.quietStart,
    quietEnd: patch.quietEnd !== undefined ? patch.quietEnd : cur.quietEnd,
    quietDays: patch.quietDays !== undefined ? patch.quietDays : cur.quietDays,
    autoReply: patch.autoReply !== undefined ? patch.autoReply : cur.autoReply,
    updatedAt: now(),
  };
  s.upsert.run(
    userId,
    next.focusUntil,
    next.quietEnabled ? 1 : 0,
    next.quietStart,
    next.quietEnd,
    next.quietDays,
    next.autoReply,
    next.updatedAt
  );
  return next;
}

// Convert an absolute time into (day-of-week 0=Mon, minutes-of-day) in local tz.
function localParts(atMs) {
  const d = new Date(atMs);
  return { dow: (d.getDay() + 6) % 7, minutes: d.getHours() * 60 + d.getMinutes() };
}

const dayEnabled = (mask, dow) => ((mask >> dow) & 1) === 1;

/**
 * Is [settings] within its quiet-hours window at [atMs]? A window that crosses
 * midnight (start > end) is attributed to the day it *starts*: the after-midnight
 * tail counts only if the previous day's toggle is on.
 */
export function inQuietHours(settings, atMs = now()) {
  if (!settings.quietEnabled) return false;
  const { quietStart: start, quietEnd: end, quietDays: mask } = settings;
  if (start === end) return false; // empty window
  const { dow, minutes } = localParts(atMs);
  if (start < end) {
    return dayEnabled(mask, dow) && minutes >= start && minutes < end;
  }
  // Crosses midnight: [start, 24:00) today OR [0, end) carried from yesterday.
  if (minutes >= start) return dayEnabled(mask, dow);
  if (minutes < end) return dayEnabled(mask, (dow + 6) % 7);
  return false;
}

/** True when the user is in manual Focus or within their quiet-hours window. */
export function isUserSilenced(userId, atMs = now()) {
  const f = getFocus(userId);
  if (f.focusUntil && f.focusUntil > atMs) return true;
  return inQuietHours(f, atMs);
}

/** Filter a list of user ids down to those NOT currently silenced. */
export function filterAudible(userIds, atMs = now()) {
  return userIds.filter((id) => !isUserSilenced(id, atMs));
}

// ---- Auto-reply throttle ---------------------------------------------------

const AUTO_REPLY_COOLDOWN_MS = 2 * 60 * 60 * 1000; // one canned reply / peer / 2h

/** May we auto-reply from [userId] to [peerId] right now (cool-down elapsed)? */
export function shouldAutoReply(userId, peerId, atMs = now()) {
  const row = s.arGet.get(userId, peerId);
  return !row || atMs - row.sent_at >= AUTO_REPLY_COOLDOWN_MS;
}

export function markAutoReplied(userId, peerId, atMs = now()) {
  s.arSet.run(userId, peerId, atMs);
}

/** Drop auto-reply throttle rows older than one cool-down window (housekeeping). */
export function purgeAutoReplies(beforeMs = now() - AUTO_REPLY_COOLDOWN_MS) {
  return s.arPurge.run(beforeMs).changes;
}

export function focusView(settings) {
  return {
    focusUntil: settings.focusUntil || 0,
    focusActive: !!(settings.focusUntil && settings.focusUntil > now()),
    quietEnabled: settings.quietEnabled,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
    quietDays: settings.quietDays,
    inQuietHours: inQuietHours(settings),
    autoReply: settings.autoReply || '',
    updatedAt: settings.updatedAt || 0,
  };
}
