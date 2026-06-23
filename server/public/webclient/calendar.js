/* calendar.js — 0.38.0 "Universum" Pillar F: a unified agenda combining events,
   message reminders and scheduled calls into one chronological list. It reuses
   the existing per-feature endpoints (no new server table) and degrades
   gracefully if any one of them is unavailable. */

import { api } from './api.js';
import { el, clear, icon } from './ui.js';

const dtShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function relativeWhen(ts) {
  const diff = ts - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  let txt;
  if (mins < 1) return 'jetzt';
  if (mins < 60) txt = `${mins} Min.`;
  else if (mins < 60 * 24) txt = `${Math.round(mins / 60)} Std.`;
  else txt = `${Math.round(mins / (60 * 24))} Tg.`;
  return diff < 0 ? `vor ${txt}` : `in ${txt}`;
}

async function safe(path) { try { return await api.get(path); } catch { return null; } }

export async function renderCalendarPane(head, body, openChat) {
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Kalender' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Aktualisieren', 'aria-label': 'Aktualisieren', onClick: () => paint(body, openChat) }, icon('refresh')),
    ]),
  );
  paint(body, openChat);
}

async function paint(body, openChat) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.append(scroll);

  const items = [];
  const ev = await safe('/me/events');
  for (const e of ev?.events || []) items.push({ at: e.startAt, kind: 'event', icon: '📅', title: e.title, sub: e.chatTitle || '', chatId: e.chatId });
  const cl = await safe('/me/scheduled-calls');
  for (const c of cl?.calls || []) items.push({ at: c.startAt || c.at, kind: 'call', icon: '📞', title: c.title || 'Anruf', sub: c.chatTitle || '', chatId: c.chatId });
  const rm = await safe('/me/reminders');
  for (const r of rm?.reminders || []) items.push({ at: r.remindAt, kind: 'reminder', icon: '⏰', title: r.note || r.preview || 'Erinnerung', sub: r.chatTitle || '', chatId: r.chatId });

  items.sort((a, b) => (a.at || 0) - (b.at || 0));
  const upcoming = items.filter((i) => i.at && i.at > Date.now() - 3600_000);

  if (!upcoming.length) {
    scroll.append(el('div', { class: 'pane-empty', text: 'Nichts geplant. Termine, Erinnerungen und geplante Anrufe erscheinen hier zusammen.' }));
    return;
  }

  let lastDay = '';
  for (const it of upcoming) {
    const day = new Date(it.at).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    if (day !== lastDay) { lastDay = day; scroll.append(el('div', { class: 'agenda-day', text: day })); }
    scroll.append(el('button', { class: 'agenda-row', onClick: () => it.chatId && openChat && openChat(it.chatId) }, [
      el('div', { class: 'cal-icon', text: it.icon }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: it.title }),
        el('div', { class: 'uabout', text: `${dtShort.format(new Date(it.at))}${it.sub ? ' · ' + it.sub : ''}` }),
      ]),
      el('div', { class: 'agenda-side' }, [el('span', { class: 'agenda-rel', text: relativeWhen(it.at) })]),
    ]));
  }
}
