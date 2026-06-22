/* availpoll.js — "Terminfindung" (find-a-time availability polls). An availpoll
   is a structured message (type 'availpoll'); the slots + per-slot votes ride
   along in message.availpoll. Members mark yes/maybe/no per slot; the organiser
   locks the winning slot, which the server turns into a real 'event'. This module
   owns the create modal + the in-chat poll card. Mirrors the events pattern. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';

const MAX_SLOTS = 8;

const dtLong = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

const VOTES = [
  { key: 'yes', emoji: '✅', label: 'Passt' },
  { key: 'maybe', emoji: '🤔', label: 'Vielleicht' },
  { key: 'no', emoji: '✖️', label: 'Geht nicht' },
];

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Modal to create an availability poll in [chatId]. */
export function newAvailPollModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Worum geht es? (z. B. Brettspielabend)', maxlength: '140' });
  const place = el('input', { class: 'input', placeholder: 'Ort (optional)', maxlength: '200' });
  const slots = el('div', { class: 'avail-edit-slots' });
  const err = el('div', { class: 'formerr' });

  const addSlot = (date) => {
    if (slots.children.length >= MAX_SLOTS) return;
    const base = date || new Date(Date.now() + (slots.children.length + 1) * 86400_000);
    base.setMinutes(0, 0, 0);
    const inp = el('input', { class: 'input', type: 'datetime-local', value: toLocalInput(base),
      min: toLocalInput(new Date()) });
    const row = el('div', { class: 'avail-edit-row' }, [
      icon('whenpoll', 'sm muted'),
      inp,
      el('button', { class: 'iconbtn', title: 'Entfernen', tabindex: '-1',
        onClick: () => { if (slots.children.length > 2) row.remove(); } }, icon('close', 'sm')),
    ]);
    slots.appendChild(row);
  };
  addSlot(); addSlot();

  const addBtn = el('button', { class: 'btn ghost sm', type: 'button',
    onClick: () => addSlot() }, [icon('plus', 'sm'), el('span', { text: 'Vorschlag' })]);

  const m = modal({
    title: 'Terminfindung starten',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Ort' }), place]),
      el('label', { class: 'hint', text: 'Zeitvorschläge (2–8)' }),
      slots,
      addBtn,
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Terminfindung posten')],
  });
  setTimeout(() => title.focus(), 50);

  async function create() {
    err.textContent = '';
    const t = title.value.trim();
    const options = [...slots.querySelectorAll('input')]
      .map((i) => (i.value ? new Date(i.value).getTime() : NaN))
      .filter((n) => Number.isFinite(n));
    if (!t) { err.textContent = 'Bitte gib einen Titel ein.'; return; }
    if (options.length < 2) { err.textContent = 'Mindestens zwei Zeitvorschläge.'; return; }
    if (options.some((o) => o < Date.now() - 60000)) { err.textContent = 'Ein Vorschlag liegt in der Vergangenheit.'; return; }
    try {
      await api.post(`/chats/${chatId}/availpolls`, { title: t, location: place.value.trim(), options });
      telemetry.track('availpoll_create', { slots: options.length });
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte die Terminfindung nicht starten.'; }
  }
}

/** Render the in-chat availability-poll card for message [m]. */
export function renderAvailPoll(m) {
  const ap = m.availpoll || {};
  const me = store.state.me?.id;
  const isOrganiser = ap.creatorId === me;
  const card = el('div', { class: `avail-card ${ap.closed ? 'closed' : ''}` });

  card.append(el('div', { class: 'avail-head' }, [
    el('div', { class: 'avail-icon', 'aria-hidden': 'true' }, icon('whenpoll')),
    el('div', { class: 'avail-meta' }, [
      el('div', { class: 'avail-title', text: ap.title || 'Terminfindung' }),
      el('div', { class: 'avail-sub', text: ap.closed
        ? '✅ Termin festgelegt'
        : (ap.location ? `📍 ${ap.location}` : 'Wann passt es dir?') }),
    ]),
  ]));

  // Highest yes-count across slots, for a little bar scale.
  const maxYes = Math.max(1, ...(ap.options || []).map((o) => o.counts?.yes || 0));

  for (const opt of ap.options || []) {
    const chosen = ap.chosenOptionId === opt.id;
    const best = ap.bestOptionId === opt.id;
    const row = el('div', { class: `avail-slot ${chosen ? 'chosen' : ''} ${best ? 'best' : ''}` });
    row.append(el('div', { class: 'avail-slot-head' }, [
      el('span', { class: 'avail-when', text: dtLong.format(new Date(opt.startAt)) }),
      best && !ap.closed ? el('span', { class: 'avail-badge', text: 'Favorit' }) : null,
      chosen ? el('span', { class: 'avail-badge ok', text: 'Festgelegt' }) : null,
    ].filter(Boolean)));

    // yes-strength bar.
    const yes = opt.counts?.yes || 0;
    row.append(el('div', { class: 'avail-bar' }, el('i', { style: { width: `${(yes / maxYes) * 100}%` } })));

    if (!ap.closed) {
      const group = el('div', { class: 'avail-votes', role: 'group', 'aria-label': 'Verfügbarkeit' });
      for (const v of VOTES) {
        const on = opt.myVote === v.key;
        const n = opt.counts?.[v.key] || 0;
        group.append(el('button', {
          class: `avail-vote ${v.key} ${on ? 'on' : ''}`,
          'aria-pressed': on ? 'true' : 'false', title: v.label,
          onClick: () => vote(m, opt.id, on ? null : v.key),
        }, [
          el('span', { 'aria-hidden': 'true', text: v.emoji }),
          el('span', { class: 'avail-count', text: String(n) }),
        ]));
      }
      row.append(group);
      if (isOrganiser) {
        row.append(el('button', { class: 'btn sm ghost avail-lock',
          onClick: () => lock(m, opt.id) }, 'Diesen Termin festlegen'));
      }
    } else {
      // Closed: show the final tally as a quiet summary.
      row.append(el('div', { class: 'avail-final', text:
        `✅ ${opt.counts?.yes || 0} · 🤔 ${opt.counts?.maybe || 0} · ✖️ ${opt.counts?.no || 0}` }));
    }
    card.append(row);
  }

  if (!ap.closed && isOrganiser) {
    card.append(el('div', { class: 'avail-hint', text: 'Du bist Organisator:in — lege den finalen Termin fest, sobald genug abgestimmt haben.' }));
  }
  return card;
}

async function vote(m, optionId, voteKey) {
  try {
    const chatId = m.chatId || store.state.activeId;
    await api.post(`/chats/${chatId}/messages/${m.id}/availpoll/vote`, { optionId, vote: voteKey });
    telemetry.track('availpoll_vote', { vote: voteKey || 'withdraw' });
  } catch (e) { toast(e.message || 'Abstimmung fehlgeschlagen.', 'err'); }
}

async function lock(m, optionId) {
  try {
    const chatId = m.chatId || store.state.activeId;
    await api.post(`/chats/${chatId}/messages/${m.id}/availpoll/lock`, { optionId, remindMinutes: 30 });
    telemetry.track('availpoll_lock');
    toast('Termin festgelegt — er steht jetzt im Chat.', 'ok');
  } catch (e) { toast(e.message || 'Konnte den Termin nicht festlegen.', 'err'); }
}
