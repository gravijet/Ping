/* activity.js — the in-app activity / notifications center. A persisted,
   device-local feed of "things that happened to you": someone reacted to your
   message, you were @-mentioned, a new chat or group appeared, or you missed a
   call. The nav-rail bell shows a badge with the unseen count; opening the panel
   marks everything seen.

   Sources are events the client already receives (socket pushes wired in app.js,
   plus a one-shot /calls backfill when the panel opens), so nothing new is sent
   to the server. The feed is a capped ring buffer in localStorage so it survives
   reloads. record() dedupes bursty events (e.g. several reactions on the same
   message collapse into one freshening entry). */

import { el, clear, icon, avatar, escapeHtml } from './ui.js';
import * as store from './store.js';
import { api } from './api.js';
import { flag } from './flags.js';

const KEY = 'ping.activity';
const SEEN_KEY = 'ping.activity.seen';
const MAX = 60;
const DEDUPE_MS = 60 * 60 * 1000; // collapse same-key events within an hour

const subs = new Set();
let items = load();

function load() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX))); } catch { /* quota */ }
}
function seenAt() { return Number(localStorage.getItem(SEEN_KEY) || 0); }

export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of subs) { try { fn(); } catch { /* ignore */ } } }

/** Number of feed entries newer than the last time the panel was opened. */
export function unseenCount() {
  const t = seenAt();
  return items.filter((it) => it.t > t).length;
}

export function markSeen() {
  localStorage.setItem(SEEN_KEY, String(Date.now()));
  notify();
}

export function clearAll() { items = []; persist(); notify(); }

/* Record an activity entry. `key` collapses duplicates (same key within an hour
   just freshens the timestamp + bumps a count instead of stacking up). */
export function record({ kind, key, chatId = null, title = '', text = '', emoji = '' }) {
  if (!flag('activityCenter')) return;
  const now = Date.now();
  const dkey = key || `${kind}:${chatId}:${title}:${text}`;
  const existing = items.find((it) => it.key === dkey && now - it.t < DEDUPE_MS);
  if (existing) {
    existing.t = now;
    existing.count = (existing.count || 1) + 1;
    if (emoji) existing.emoji = emoji;
  } else {
    items.push({ id: now + '-' + Math.random().toString(36).slice(2, 7), key: dkey, t: now,
      kind, chatId, title, text, emoji, count: 1 });
    if (items.length > MAX) items = items.slice(-MAX);
  }
  persist();
  notify();
}

// ---- relative time --------------------------------------------------------
function ago(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}

const ICONS = { reaction: 'react', mention: 'chat', newchat: 'edit', join: 'group', missedcall: 'callMissed' };

// ---- backfill: missed calls from the server log ---------------------------
async function backfillMissedCalls() {
  let calls = [];
  try { ({ calls } = await api.get('/calls')); } catch { return; }
  for (const c of (calls || []).slice(0, 15)) {
    if (c.direction !== 'incoming') continue;
    if (c.outcome !== 'missed' && c.outcome !== 'declined') continue;
    const now = Date.now();
    const dkey = 'missedcall:' + c.id;
    if (items.some((it) => it.key === dkey)) continue;
    items.push({ id: 'mc-' + c.id, key: dkey, t: c.createdAt || now, kind: 'missedcall',
      chatId: null, peerId: c.peer?.id, title: c.peer?.displayName || 'Unbekannt',
      text: c.outcome === 'declined' ? 'Anruf abgelehnt' : 'Verpasster Anruf', emoji: '', count: 1 });
  }
  items.sort((a, b) => a.t - b.t);
  if (items.length > MAX) items = items.slice(-MAX);
  persist();
}

// ---- panel ----------------------------------------------------------------
let panel = null;

export function isOpen() { return !!panel; }

export async function openActivityPanel(onOpenChat) {
  if (panel) return closePanel();
  const list = el('div', { class: 'activity-list' });
  const head = el('div', { class: 'activity-head' }, [
    el('h3', { text: 'Aktivität' }),
    el('div', { class: 'activity-head-actions' }, [
      el('button', { class: 'btn ghost sm', title: 'Alles löschen',
        onClick: () => { clearAll(); paint(list, onOpenChat); } }, 'Leeren'),
      el('button', { class: 'iconbtn', title: 'Schließen', onClick: closePanel }, icon('close')),
    ]),
  ]);
  const card = el('aside', { class: 'activity-panel', role: 'dialog', 'aria-label': 'Aktivität',
    'aria-modal': 'false' }, [head, list]);
  const back = el('div', { class: 'activity-back', onClick: (e) => { if (e.target === back) closePanel(); } }, card);
  document.body.appendChild(back);
  panel = { back, esc: null };
  panel.esc = (e) => { if (e.key === 'Escape') closePanel(); };
  document.addEventListener('keydown', panel.esc);
  requestAnimationFrame?.(() => card.classList.add('show'));
  card.classList.add('show');

  list.append(el('div', { class: 'activity-empty', text: 'Lade …' }));
  await backfillMissedCalls();
  paint(list, onOpenChat);
  markSeen();
}

function closePanel() {
  if (!panel) return;
  document.removeEventListener('keydown', panel.esc);
  panel.back.remove();
  panel = null;
}

function paint(list, onOpenChat) {
  clear(list);
  const ordered = items.slice().sort((a, b) => b.t - a.t);
  if (!ordered.length) {
    list.append(el('div', { class: 'activity-empty' }, [
      icon('bell'),
      el('p', { text: 'Keine neue Aktivität. Reaktionen, Erwähnungen und verpasste Anrufe erscheinen hier.' }),
    ]));
    return;
  }
  for (const it of ordered) list.append(row(it, onOpenChat));
}

function row(it, onOpenChat) {
  const chat = it.chatId ? store.getChat(it.chatId) : null;
  const av = it.emoji
    ? el('div', { class: 'activity-emoji', text: it.emoji })
    : (chat ? avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
        hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 40,
        { kind: chat.type === 'group' ? 'chat' : 'user' })
      : el('div', { class: 'activity-ic' }, icon(ICONS[it.kind] || 'bell')));
  const count = it.count > 1 ? ` ×${it.count}` : '';
  const title = (chat?.title || it.title || 'Ping');
  const r = el('button', { class: 'activity-row', type: 'button',
    onClick: () => {
      if (it.chatId && onOpenChat) { onOpenChat(it.chatId); closePanel(); }
    } }, [
    av,
    el('div', { class: 'activity-main' }, [
      el('div', { class: 'activity-title' }, [
        el('span', { text: title }),
        el('span', { class: 'activity-time', text: ago(it.t) }),
      ]),
      el('div', { class: 'activity-text', html: escapeHtml(it.text + count) }),
    ]),
  ]);
  return r;
}
