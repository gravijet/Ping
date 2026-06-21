/* scheduledcalls.js — "Geplante Anrufe" (0.34.0). Schedule a call in a chat with
   an optional pre-call reminder (fired by the server's maintenance sweep). Plus a
   small list of your upcoming scheduled calls. */

import { api } from './api.js';
import { el, clear, icon, modal, toast } from './ui.js';

const REMIND = [[0, 'Keine'], [5, '5 Min vorher'], [10, '10 Min vorher'], [30, '30 Min vorher'], [60, '1 Std vorher']];

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduleCallModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel (optional)', maxlength: '140' });
  const def = new Date(Date.now() + 60 * 60 * 1000); def.setMinutes(0, 0, 0);
  const when = el('input', { class: 'input', type: 'datetime-local', value: toLocalInput(def), min: toLocalInput(new Date()) });
  const video = el('input', { type: 'checkbox' });
  const remind = el('select', { class: 'input' }, REMIND.map(([v, l]) => el('option', { value: String(v) }, l)));
  remind.value = '10';
  const err = el('div', { class: 'formerr' });
  const m = modal({
    title: 'Anruf planen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Datum & Uhrzeit' }), when]),
      el('div', { class: 'field' }, [el('label', { text: 'Erinnerung' }), remind]),
      el('label', { class: 'check-row' }, [video, el('span', { text: 'Videoanruf' })]),
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, [icon('phone'), 'Planen'])],
  });
  setTimeout(() => when.focus(), 50);
  async function create() {
    const startAt = when.value ? new Date(when.value).getTime() : NaN;
    if (!Number.isFinite(startAt) || startAt < Date.now()) { err.textContent = 'Wähle einen Zeitpunkt in der Zukunft.'; return; }
    try {
      await api.post(`/chats/${chatId}/scheduled-calls`, {
        title: title.value.trim(), startAt, video: video.checked, remindMinutes: Number(remind.value) || 0,
      });
      toast('Anruf geplant.', 'ok');
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte den Anruf nicht planen.'; }
  }
}

/** A simple list of the user's upcoming scheduled calls across chats. */
export async function openUpcomingCalls(openChat) {
  const body = el('div', { class: 'sc-list' }, el('div', { class: 'hint', text: 'Lade …' }));
  modal({ title: 'Geplante Anrufe', width: '440px', body: (b) => b.append(body) });
  let calls = [];
  try { ({ calls } = await api.get('/me/scheduled-calls')); } catch { /* offline */ }
  clear(body);
  if (!calls?.length) { body.append(el('div', { class: 'pane-empty', text: 'Keine geplanten Anrufe.' })); return; }
  for (const c of calls) {
    const when = new Date(c.startAt).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    body.append(el('button', { class: 'sc-row', onClick: () => openChat?.(c.chatId) }, [
      el('div', { class: 'sc-ic' }, icon(c.video ? 'video' : 'phone')),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: c.title || (c.video ? 'Videoanruf' : 'Anruf') }),
        el('div', { class: 'uabout', text: `${when} · ${c.chatTitle || ''}` }),
      ]),
    ]));
  }
}
