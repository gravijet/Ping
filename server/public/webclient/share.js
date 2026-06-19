/* share.js — social sharing. Uses the native Web Share sheet where the browser
   supports it (mobile, some desktops) and falls back to copying to the
   clipboard with a toast everywhere else, so the affordance always does
   *something* useful. No tracking, no third-party share widgets. */

import { toast } from './ui.js';
import { track } from './telemetry.js';

export function canShare() { return typeof navigator.share === 'function'; }

/** The public entry point others use to install Ping Web. */
export function inviteUrl() { return location.origin + '/'; }

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts / older browsers.
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/** Share via the OS sheet if available, otherwise copy a sensible string to the
    clipboard. Returns true if the user was offered/given something. */
export async function shareOrCopy({ title, text, url } = {}) {
  const payload = {};
  if (title) payload.title = title;
  if (text) payload.text = text;
  if (url) payload.url = url;
  if (canShare()) {
    try { await navigator.share(payload); track('share', { kind: 'native' }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; /* fall through */ }
  }
  const joined = [text, url].filter(Boolean).join('\n');
  const ok = await copy(joined || title || '');
  toast(ok ? 'In die Zwischenablage kopiert.' : 'Teilen nicht möglich.', ok ? 'ok' : 'err');
  track('share', { kind: ok ? 'clipboard' : 'failed' });
  return ok;
}

/** Invite someone to Ping. */
export function shareInvite() {
  return shareOrCopy({
    title: 'Ping',
    text: 'Schreib mir auf Ping – schneller, moderner Messenger. 💬',
    url: inviteUrl(),
  });
}

/** Share a single message's text. */
export function shareMessage(msg) {
  const text = (msg && msg.body) ? msg.body : '';
  if (!text.trim()) { toast('Diese Nachricht hat keinen teilbaren Text.'); return Promise.resolve(false); }
  return shareOrCopy({ title: 'Ping', text });
}

/** A deep link that opens a person's profile card (handled by app.js on load). */
export function profileUrl(userId) {
  return `${location.origin}/?u=${encodeURIComponent(userId)}`;
}

/** Share a link to a person. Uses a ?u= deep link that opens their profile (and
    offers to start a chat) when the recipient already uses Ping; falls back to
    the generic invite when we don't have an id. */
export function shareProfile(user) {
  const name = user?.displayName || 'jemandem';
  return shareOrCopy({
    title: `${name} auf Ping`,
    text: `Schreib ${name} auf Ping.`,
    url: user?.id ? profileUrl(user.id) : inviteUrl(),
  });
}

/** Copy a deep link that opens a specific chat (handled by app.js on load). */
export function shareChatLink(chatId) {
  const url = `${location.origin}/?chat=${encodeURIComponent(chatId)}`;
  return shareOrCopy({ title: 'Ping-Chat', url });
}
