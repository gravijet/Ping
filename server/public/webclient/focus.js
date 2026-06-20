/* focus.js — Focus mode & quiet hours ("Finden & Fokus", 0.30.0).

   A per-account, device-synced switch that asks the server to hold back push
   notifications while you're in Focus or inside your quiet-hours window (live
   messages still arrive instantly over the socket — you just aren't pinged). It
   can also fire a one-time auto-reply to direct messages that land while you're
   away. This module owns the settings dialog, the quick toggle and the live
   nav-rail indicator state.

   Gated by the `focusMode` feature flag (see flags.js). */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, switchEl } from './ui.js';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let focus = {
  focusUntil: 0, focusActive: false,
  quietEnabled: false, quietStart: 1320, quietEnd: 420, quietDays: 127,
  inQuietHours: false, autoReply: '', updatedAt: 0,
};

export function state() { return focus; }
/** True when push is currently being held back (manual focus or quiet hours). */
export function isSilenced() { return !!(focus.focusActive || focus.inQuietHours); }

/** Load the user's focus settings (best-effort; silent offline). */
export async function sync() {
  try {
    focus = (await api.get('/me/focus')).focus || focus;
    store.emit('focus');
  } catch { /* offline — keep last known */ }
}

/** Live socket hook (wired in app.js): another device changed the settings. */
export function apply(f) { if (f) { focus = f; store.emit('focus'); } }

async function save(patch) {
  const prev = focus;
  try {
    focus = (await api.put('/me/focus', patch)).focus;
    store.emit('focus');
    return true;
  } catch (e) {
    focus = prev;
    store.emit('focus'); // repaint so an optimistic toggle snaps back
    toast(e.message || 'Konnte nicht gespeichert werden.', 'err');
    return false;
  }
}

// ---- minutes-of-day <-> "HH:MM" -------------------------------------------
function toTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fromTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1439 ? v : null;
}

function focusUntilLabel() {
  if (!focus.focusActive) return '';
  const d = new Date(focus.focusUntil);
  return 'bis ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ---- quick toggle ----------------------------------------------------------

/** Turn manual Focus on for [minutes] (0 / falsey = off). */
export async function setQuickFocus(minutes) {
  const focusUntil = minutes ? Date.now() + minutes * 60_000 : 0;
  if (await save({ focusUntil })) {
    toast(minutes ? `Fokus aktiv ${focusUntilLabel()}.` : 'Fokus beendet.');
  }
}

// ---- settings dialog -------------------------------------------------------

export function openFocus() {
  const body = el('div', { class: 'focus-pane' });
  const m = modal({ title: 'Fokus & Ruhezeiten', width: '480px', body: (b) => b.append(body) });

  const paint = () => {
    clear(body);

    // --- Manual focus quick-set ---
    const presets = [
      ['30 Min', 30], ['1 Stunde', 60], ['4 Stunden', 240], ['Bis morgen', minutesUntilTomorrow(8)],
    ];
    const quick = el('div', { class: 'focus-quick' },
      presets.map(([label, min]) =>
        el('button', { class: 'btn ghost', onClick: () => setQuickFocus(min) }, label)));
    const statusLine = focus.focusActive
      ? el('div', { class: 'focus-on' }, [icon('moon', 'sm'),
          el('span', { text: `Fokus aktiv ${focusUntilLabel()}` }),
          el('button', { class: 'btn sm', onClick: () => setQuickFocus(0) }, 'Beenden')])
      : el('div', { class: 'hint', text: 'Halte Benachrichtigungen vorübergehend zurück.' });

    body.append(
      el('div', { class: 'focus-section' }, [
        el('div', { class: 'focus-h' }, [icon('moon', 'sm'), el('span', { text: 'Fokus' })]),
        statusLine,
        quick,
      ]),
    );

    // --- Quiet hours ---
    const quietToggle = switchEl(focus.quietEnabled, (on) => save({ quietEnabled: on }));
    const start = el('input', { class: 'input sm', type: 'time', value: toTime(focus.quietStart),
      onchange: (e) => { const v = fromTime(e.target.value); if (v != null) save({ quietStart: v }); } });
    const end = el('input', { class: 'input sm', type: 'time', value: toTime(focus.quietEnd),
      onchange: (e) => { const v = fromTime(e.target.value); if (v != null) save({ quietEnd: v }); } });
    const dayBtns = el('div', { class: 'focus-days' }, DAYS.map((d, i) => {
      const on = (focus.quietDays >> i) & 1;
      return el('button', { class: `focus-day ${on ? 'on' : ''}`, type: 'button',
        'aria-pressed': on ? 'true' : 'false', title: d,
        onClick: () => save({ quietDays: focus.quietDays ^ (1 << i) }) }, d);
    }));
    const quietDetail = el('div', { class: 'focus-quiet-detail', hidden: !focus.quietEnabled }, [
      el('div', { class: 'focus-times' }, [
        el('label', { text: 'Von' }), start,
        el('label', { text: 'Bis' }), end,
      ]),
      dayBtns,
      focus.inQuietHours ? el('div', { class: 'focus-now hint', text: 'Ruhezeit ist gerade aktiv.' }) : null,
    ].filter(Boolean));

    body.append(
      el('div', { class: 'focus-section' }, [
        el('div', { class: 'focus-h with-toggle' }, [
          el('div', {}, [icon('clock', 'sm'), el('span', { text: 'Ruhezeiten' })]),
          quietToggle,
        ]),
        el('div', { class: 'hint', text: 'Jeden Tag im gewählten Zeitfenster keine Push-Benachrichtigungen.' }),
        quietDetail,
      ]),
    );

    // --- Auto-reply ---
    const ar = el('textarea', { class: 'input', rows: '2', maxlength: '500',
      placeholder: 'z. B. „Bin im Fokus, melde mich später.“', value: focus.autoReply });
    const arSave = el('button', { class: 'btn primary sm',
      onClick: async () => { if (await save({ autoReply: ar.value.trim() })) toast('Auto-Antwort gespeichert.'); } });
    arSave.append(icon('check', 'sm'), document.createTextNode(' Speichern'));
    body.append(
      el('div', { class: 'focus-section' }, [
        el('div', { class: 'focus-h' }, [icon('reply', 'sm'), el('span', { text: 'Auto-Antwort (Direktnachrichten)' })]),
        el('div', { class: 'hint', text: 'Wird höchstens einmal alle 2 Stunden pro Kontakt gesendet, solange Fokus/Ruhezeit aktiv ist.' }),
        ar,
        el('div', { style: { textAlign: 'right', marginTop: '6px' } }, arSave),
      ]),
    );
  };

  paint();
  const off = store.on('focus', paint);
  const orig = m.close;
  m.close = () => { off && off(); orig(); };
  return m;
}

// Minutes from now until tomorrow at [hour]:00 local time.
function minutesUntilTomorrow(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return Math.max(1, Math.round((d.getTime() - Date.now()) / 60_000));
}
