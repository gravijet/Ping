/* events.js — "Termine" (events with RSVP). An event is a structured message
   (type 'event'); the payload rides along in message.event. This module owns the
   create modal, the in-chat event card (RSVP buttons + live tallies + countdown)
   and the cross-chat "Termine" agenda pane. Mirrors the poll pattern in chat.js. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';

const RSVP = [
  { key: 'going', label: 'Zusage', emoji: '✅' },
  { key: 'maybe', label: 'Vielleicht', emoji: '🤔' },
  { key: 'declined', label: 'Absage', emoji: '✖️' },
];

const dtLong = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const dtShort = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

/** A human "in 3 Std." / "vor 5 Min." / "läuft" relative label for a start time. */
function relativeWhen(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const past = diff < 0;
  let txt;
  if (mins < 1) return past ? 'gerade eben' : 'jetzt';
  if (mins < 60) txt = `${mins} Min.`;
  else if (mins < 60 * 24) txt = `${Math.round(mins / 60)} Std.`;
  else txt = `${Math.round(mins / (60 * 24))} Tg.`;
  return past ? `vor ${txt}` : `in ${txt}`;
}

// datetime-local wants a local "YYYY-MM-DDTHH:mm" string (no timezone suffix).
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const REMIND_OPTIONS = [
  [0, 'Keine Erinnerung'],
  [10, '10 Minuten vorher'],
  [30, '30 Minuten vorher'],
  [60, '1 Stunde vorher'],
  [1440, '1 Tag vorher'],
];

/** Modal to create an event in [chatId]. */
export function newEventModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Worum geht es?', maxlength: '140' });
  // Default to the next full hour, an hour out.
  const def = new Date(Date.now() + 60 * 60 * 1000);
  def.setMinutes(0, 0, 0);
  const when = el('input', { class: 'input', type: 'datetime-local', value: toLocalInput(def),
    min: toLocalInput(new Date()) });
  const place = el('input', { class: 'input', placeholder: 'Ort (optional)', maxlength: '200' });
  const desc = el('textarea', { class: 'input', placeholder: 'Beschreibung (optional)', rows: '2',
    maxlength: '2000' });
  const remind = el('select', { class: 'input' },
    REMIND_OPTIONS.map(([v, l]) => el('option', { value: String(v) }, l)));
  remind.value = '30';
  const err = el('div', { class: 'formerr' });

  const m = modal({
    title: 'Termin erstellen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Datum & Uhrzeit' }), when]),
      el('div', { class: 'field' }, [el('label', { text: 'Ort' }), place]),
      el('div', { class: 'field' }, [el('label', { text: 'Beschreibung' }), desc]),
      el('div', { class: 'field' }, [el('label', { text: 'Erinnerung' }), remind]),
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Termin erstellen')],
  });
  setTimeout(() => title.focus(), 50);

  async function create() {
    err.textContent = '';
    const t = title.value.trim();
    const startAt = when.value ? new Date(when.value).getTime() : NaN;
    if (!t) { err.textContent = 'Bitte gib einen Titel ein.'; return; }
    if (!Number.isFinite(startAt)) { err.textContent = 'Bitte wähle Datum und Uhrzeit.'; return; }
    if (startAt < Date.now() - 60000) { err.textContent = 'Der Termin liegt in der Vergangenheit.'; return; }
    try {
      await api.post(`/chats/${chatId}/events`, {
        title: t,
        startAt,
        location: place.value.trim(),
        description: desc.value.trim(),
        remindMinutes: Number(remind.value) || 0,
      });
      telemetry.track('event_create', { remind: Number(remind.value) || 0 });
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte den Termin nicht erstellen.'; }
  }
}

/** Render the in-chat event card for message [m]. */
export function renderEvent(m, { onRsvp } = {}) {
  const ev = m.event || {};
  const past = ev.startAt && ev.startAt < Date.now();
  const card = el('div', { class: `event-card ${past ? 'past' : ''}` });

  card.append(el('div', { class: 'event-head' }, [
    el('div', { class: 'event-cal', 'aria-hidden': 'true' }, [
      el('span', { class: 'm', text: new Date(ev.startAt).toLocaleString('de-DE', { month: 'short' }) }),
      el('span', { class: 'd', text: String(new Date(ev.startAt).getDate()) }),
    ]),
    el('div', { class: 'event-meta' }, [
      el('div', { class: 'event-title', text: ev.title || 'Termin' }),
      el('div', { class: 'event-when' }, [
        icon('clock', 'sm'),
        el('span', { text: dtLong.format(new Date(ev.startAt)) }),
        el('span', { class: 'event-rel', text: relativeWhen(ev.startAt) }),
      ]),
      ev.location ? el('div', { class: 'event-loc' }, [icon('pin', 'sm'), el('span', { text: ev.location })]) : null,
    ].filter(Boolean)),
  ]));

  if (ev.description) card.append(el('div', { class: 'event-desc', text: ev.description }));

  // RSVP buttons — accessible toggle group reflecting the viewer's own answer.
  const group = el('div', { class: 'event-rsvp', role: 'group', 'aria-label': 'Zu-/Absage' });
  for (const opt of RSVP) {
    const active = ev.myStatus === opt.key;
    const n = ev.counts?.[opt.key] || 0;
    group.append(el('button', {
      class: `rsvp-btn ${opt.key} ${active ? 'on' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      title: opt.label,
      onClick: () => setRsvp(m, active ? null : opt.key, onRsvp),
    }, [
      el('span', { class: 'rsvp-emoji', 'aria-hidden': 'true', text: opt.emoji }),
      el('span', { class: 'rsvp-label', text: opt.label }),
      el('span', { class: 'rsvp-count', text: String(n) }),
    ]));
  }
  card.append(group);

  // Attendee summary line ("Anna, Bob + 2 dabei").
  const going = (ev.attendees || []).filter((a) => a.status === 'going');
  if (going.length) {
    const names = going.slice(0, 2).map((a) => a.displayName).join(', ');
    const extra = going.length > 2 ? ` +${going.length - 2}` : '';
    card.append(el('div', { class: 'event-attendees', text: `👥 ${names}${extra} dabei` }));
  }
  return card;
}

async function setRsvp(m, status, onRsvp) {
  try {
    const chatId = m.chatId || (store.state.activeId);
    const { message } = await api.post(`/chats/${chatId}/messages/${m.id}/rsvp`, { status });
    telemetry.track('event_rsvp', { status: status || 'withdraw' });
    if (onRsvp) onRsvp(message);
  } catch (e) { toast(e.message || 'Antwort fehlgeschlagen.', 'err'); }
}

// ---- "Termine" agenda pane ------------------------------------------------

export async function renderAgendaPane(head, body, openChat) {
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Termine' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Aktualisieren', 'aria-label': 'Aktualisieren',
        onClick: () => paint(body, openChat) }, icon('refresh')),
    ]),
  );
  paint(body, openChat);
  // Refresh live when an event card changes (RSVP / new event over the socket).
  store.on('events', () => { if (document.body.contains(body)) paint(body, openChat); });
}

async function paint(body, openChat) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.appendChild(scroll);
  // Skeleton while loading.
  for (let i = 0; i < 3; i++) scroll.appendChild(el('div', { class: 'agenda-skel' }));

  let events = [];
  try { ({ events } = await api.get('/me/events')); }
  catch { clear(scroll); scroll.appendChild(el('div', { class: 'pane-empty', text: 'Termine konnten nicht geladen werden.' })); return; }

  clear(scroll);
  if (!events.length) {
    scroll.appendChild(el('div', { class: 'pane-empty',
      text: 'Keine anstehenden Termine. Erstelle einen über das 📎-Menü in einem Chat.' }));
    return;
  }

  // Group by day for a calendar-like agenda.
  let lastDay = '';
  for (const ev of events) {
    const day = new Date(ev.startAt).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    if (day !== lastDay) {
      lastDay = day;
      scroll.appendChild(el('div', { class: 'agenda-day', text: day }));
    }
    const mine = ev.myStatus === 'going';
    scroll.appendChild(el('button', { class: 'agenda-row', onClick: () => openChat(ev.chatId) }, [
      el('div', { class: `agenda-dot ${ev.myStatus || ''}`, 'aria-hidden': 'true' }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: ev.title }),
        el('div', { class: 'uabout', text:
          `${dtShort.format(new Date(ev.startAt))} · ${ev.chatTitle || ''}` +
          (ev.location ? ` · ${ev.location}` : '') }),
      ]),
      el('div', { class: 'agenda-side' }, [
        el('span', { class: 'agenda-rel', text: relativeWhen(ev.startAt) }),
        ev.counts?.going ? el('span', { class: 'agenda-going', text: `✅ ${ev.counts.going}` }) : null,
        mine ? el('span', { class: 'agenda-you', text: 'Du bist dabei' }) : null,
      ].filter(Boolean)),
    ]));
  }
}
