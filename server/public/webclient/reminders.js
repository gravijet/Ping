/* reminders.js — message reminders ("Erinnere mich").

   Ask Ping to nudge you about a specific message at a chosen time. The server
   stores a snapshot (so the nudge survives the message being deleted) and fires
   it over the socket — and via push when the tab is closed. This module owns the
   "set a reminder" dialog, the reminders pane, and the live-fire toast.

   Gated by the `reminders` feature flag (see flags.js). */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, confirmModal } from './ui.js';

let reminders = []; // [{id, chatId, messageId, note, preview, chatTitle, remindAt, firedAt}]

export function all() { return reminders; }
export function pendingCount() { return reminders.filter((r) => !r.firedAt).length; }

/** Load the user's reminders (best-effort; silent offline). */
export async function sync() {
  try {
    reminders = (await api.get('/me/reminders')).reminders || [];
    store.emit('reminders');
  } catch { /* offline */ }
}

// ---- live socket hooks (wired in app.js) ----------------------------------

export function onCreated(r) { upsert(r); }
export function onDeleted(id) {
  reminders = reminders.filter((r) => r.id !== id);
  store.emit('reminders');
}
export function onFired(r) {
  upsert(r);
  toast(`⏰ ${r.note || r.preview || 'Erinnerung'}`);
  store.emit('reminders');
}

function upsert(r) {
  const i = reminders.findIndex((x) => x.id === r.id);
  if (i >= 0) reminders[i] = r; else reminders.unshift(r);
  store.emit('reminders');
}

// ---- preset times ---------------------------------------------------------

function presetTimes() {
  const now = new Date();
  const inMin = (m) => Date.now() + m * 60000;
  const at = (h, m, addDays = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + addDays);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const out = [
    ['In 20 Minuten', inMin(20)],
    ['In 1 Stunde', inMin(60)],
    ['In 3 Stunden', inMin(180)],
  ];
  // Only offer "tonight" if it's still comfortably ahead.
  const tonight = at(18, 0);
  if (tonight > Date.now() + 30 * 60000) out.push(['Heute Abend, 18:00', tonight]);
  out.push(['Morgen früh, 9:00', at(9, 0, 1)]);
  out.push(['Nächste Woche', at(9, 0, 7)]);
  return out;
}

// Format an epoch-ms for the <input type="datetime-local"> value (local tz).
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatWhen(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `Heute, ${time}`;
  if (days === 1) return `Morgen, ${time}`;
  if (days === -1) return `Gestern, ${time}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) + `, ${time}`;
}

// ---- create dialog --------------------------------------------------------

/** Dialog to set a reminder for [message] in [chatId]. */
export function setReminderDialog(chatId, message) {
  const presets = presetTimes();
  const note = el('input', { class: 'input', maxlength: '500',
    placeholder: 'Notiz (optional) — woran soll ich dich erinnern?' });
  const custom = el('input', { class: 'input', type: 'datetime-local',
    min: toLocalInput(Date.now() + 60000), value: toLocalInput(Date.now() + 60 * 60000) });

  const submit = async (remindAt) => {
    if (!Number.isFinite(remindAt) || remindAt < Date.now() - 60000) {
      return toast('Bitte einen Zeitpunkt in der Zukunft wählen.', 'err');
    }
    try {
      await api.post(`/chats/${chatId}/messages/${message.id}/remind`,
        { remindAt: Math.round(remindAt), note: note.value.trim() });
      m.close();
      toast('Erinnerung gesetzt für ' + formatWhen(remindAt) + '.');
    } catch (e) { toast(e.message || 'Erinnerung fehlgeschlagen.', 'err'); }
  };

  const presetBtns = el('div', { class: 'reminder-presets' },
    presets.map(([label, ts]) =>
      el('button', { class: 'btn ghost reminder-preset', onClick: () => submit(ts) }, [
        el('span', { text: label }),
        el('span', { class: 'reminder-preset-when', text: formatWhen(ts) }),
      ])));

  const m = modal({
    title: '⏰ Erinnere mich',
    width: '440px',
    body: (b) => b.append(
      el('div', { class: 'reminder-snap', text: (message.body || '').trim() || 'Diese Nachricht' }),
      el('div', { class: 'field' }, [el('label', { text: 'Notiz' }), note]),
      el('div', { class: 'reminder-label hint', text: 'Schnell wählen' }),
      presetBtns,
      el('div', { class: 'field', style: { marginTop: '12px' } }, [
        el('label', { text: 'Eigener Zeitpunkt' }),
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('div', { style: { flex: '1' } }, custom),
          el('button', { class: 'btn primary sm',
            onClick: () => submit(new Date(custom.value).getTime()) }, 'Setzen'),
        ]),
      ]),
    ),
  });
  setTimeout(() => note.focus(), 0);
  return m;
}

// ---- reminders pane -------------------------------------------------------

/** The reminders list: pending (soonest first) then recently fired. */
export function openReminders(onOpenChat) {
  const list = el('div', { class: 'reminder-list' });
  const m = modal({ title: 'Erinnerungen', width: '460px', body: (b) => b.append(list) });

  const paint = () => {
    clear(list);
    if (!reminders.length) {
      list.append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-emoji', text: '⏰' }),
        el('div', { class: 'hint', text: 'Keine Erinnerungen. Tippe lange auf eine Nachricht und wähle „Erinnern“.' }),
      ]));
      return;
    }
    for (const r of reminders) {
      const fired = !!r.firedAt;
      const row = el('div', { class: `reminder-row ${fired ? 'fired' : ''}` }, [
        el('div', { class: 'reminder-ic' }, icon(fired ? 'check' : 'clock', 'sm')),
        el('div', { class: 'reminder-main', onClick: () => {
          if (onOpenChat && r.chatId) { m.close(); onOpenChat(r.chatId, r.messageId); }
        } }, [
          el('div', { class: 'reminder-when', text: (fired ? 'Erledigt · ' : '') + formatWhen(r.remindAt) }),
          el('div', { class: 'reminder-note', text: r.note || r.preview || 'Nachricht' }),
          r.chatTitle ? el('div', { class: 'reminder-chat', text: r.chatTitle }) : null,
        ].filter(Boolean)),
        el('button', { class: 'iconbtn', title: 'Entfernen', onClick: async () => {
          try { await api.del(`/me/reminders/${r.id}`); onDeleted(r.id); }
          catch (e) { toast(e.message, 'err'); }
        } }, icon('trash')),
      ]);
      list.append(row);
    }
  };

  paint();
  const off = store.on('reminders', paint);
  const origClose = m.close;
  m.close = () => { off && off(); origClose(); };
  return m;
}
