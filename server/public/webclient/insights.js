/* insights.js — private, device-local usage insights. Ping promises "kein
   Tracking", so unlike server analytics this never leaves the device: a tiny
   tally of how many messages you send per day (and to which chat) lives in
   localStorage purely so the settings screen can show you a 7-day activity
   sparkline and your most-active conversation. Nothing here is ever sent.

   recordSent(chatId) is called from the composer on a successful send. The rest
   is pure read/aggregate, so it imports cleanly under the test DOM shim. */

import { el, icon } from './ui.js';
import * as store from './store.js';

const KEY = 'ping.insights';
const DAYS_KEPT = 30;

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function read() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { days: o.days || {}, chats: o.chats || {}, since: o.since || Date.now() };
  } catch { return { days: {}, chats: {}, since: Date.now() }; }
}
function write(data) {
  // Prune days older than DAYS_KEPT so storage stays bounded.
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - DAYS_KEPT);
  const min = todayKey(cutoff);
  for (const k of Object.keys(data.days)) if (k < min) delete data.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota */ }
}

/** Tally one sent message (today + per-chat). Best-effort, never throws. */
export function recordSent(chatId) {
  try {
    const data = read();
    const k = todayKey();
    data.days[k] = (data.days[k] || 0) + 1;
    if (chatId) data.chats[chatId] = (data.chats[chatId] || 0) + 1;
    write(data);
  } catch { /* ignore */ }
}

/** Counts for the last `n` days, oldest→newest, aligned to calendar days. */
export function lastDays(n = 7) {
  const data = read();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out.push({ key: todayKey(d), label: d.toLocaleDateString('de-DE', { weekday: 'short' }),
      count: data.days[todayKey(d)] || 0 });
  }
  return out;
}

export function summary() {
  const data = read();
  const week = lastDays(7);
  const total7 = week.reduce((a, b) => a + b.count, 0);
  const today = week[week.length - 1]?.count || 0;
  const allTime = Object.values(data.days).reduce((a, b) => a + b, 0);
  let busiest = null;
  for (const [chatId, count] of Object.entries(data.chats)) {
    if (!busiest || count > busiest.count) busiest = { chatId, count };
  }
  return { week, total7, today, allTime, busiest, chatsCount: store.state.chats.size,
    since: data.since };
}

export function reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

// ---- UI -------------------------------------------------------------------
export function renderInsights(container) {
  const s = summary();
  const max = Math.max(1, ...s.week.map((d) => d.count));

  const spark = el('div', { class: 'insights-spark', role: 'img',
    'aria-label': `Gesendete Nachrichten der letzten 7 Tage: ${s.week.map((d) => d.count).join(', ')}` },
    s.week.map((d) => el('div', { class: 'spark-col' }, [
      el('div', { class: 'spark-bar', style: { height: Math.round((d.count / max) * 100) + '%' },
        title: `${d.count} am ${d.label}` }),
      el('span', { class: 'spark-x', text: d.label[0] }),
    ])));

  const stats = el('div', { class: 'insights-stats' }, [
    stat(s.today, 'heute gesendet'),
    stat(s.total7, 'letzte 7 Tage'),
    stat(s.allTime, 'insgesamt'),
    stat(s.chatsCount, 'Chats'),
  ]);

  const busiestChat = s.busiest && store.getChat(s.busiest.chatId);
  const busiestRow = busiestChat
    ? el('div', { class: 'insights-busiest' }, [
        icon('chat', 'sm'),
        el('span', { html: `Aktivster Chat: <strong>${escapeName(busiestChat.title)}</strong> · ${s.busiest.count} Nachrichten` }),
      ])
    : null;

  container.append(
    el('p', { class: 'hint', text: 'Diese Statistik wird nur auf diesem Gerät gespeichert und niemals gesendet.' }),
    spark, stats, busiestRow,
  );
}

function stat(value, label) {
  return el('div', { class: 'insight-card' }, [
    el('div', { class: 'insight-num', text: String(value) }),
    el('div', { class: 'insight-lbl', text: label }),
  ]);
}
function escapeName(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
