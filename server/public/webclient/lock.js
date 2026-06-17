/* lock.js — optional app PIN lock for this device (parity with the native app's
   screen lock). The PIN never leaves the browser: only SHA-256(salt:pin) is kept
   in prefs/localStorage. Locks on every load when enabled and after a period of
   inactivity; a full-screen keypad reveals the app again. */

import * as prefs from './prefs.js';
import { el, clear, icon, modal, toast, switchEl, setRow, confirmModal } from './ui.js';

let overlay = null;
let idleTimer = null;
let wired = false;

async function sha(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randSalt() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function lockEnabled() { return !!prefs.get('lockEnabled') && !!prefs.get('lockHash'); }
export function isLocked() { return !!overlay; }

// Called once after sign-in: lock immediately if enabled, then watch for idle.
export function initLock() {
  if (!wired) {
    wired = true;
    ['mousemove', 'keydown', 'click', 'touchstart', 'wheel'].forEach((ev) =>
      document.addEventListener(ev, resetIdle, true));
  }
  if (lockEnabled()) showLock();
  resetIdle();
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (!lockEnabled() || overlay) return;
  idleTimer = setTimeout(showLock, prefs.get('lockTimeoutMs') || 120000);
}

export function lockNow() {
  if (!lockEnabled()) { toast('Lege zuerst eine PIN fest.', 'err'); return lockSettings(); }
  showLock();
}

// ---- the keypad (shared by unlock + setup) --------------------------------
function padScreen({ title, hint, confirmOnly, onSubmit, onCancel }) {
  let entered = '';
  const dots = el('div', { class: 'lock-dots' });
  const draw = () => {
    clear(dots);
    const n = Math.max(4, entered.length);
    for (let i = 0; i < n; i++) dots.append(el('i', { class: i < entered.length ? 'on' : '' }));
  };
  const press = (d) => { if (entered.length < 8) { entered += d; draw(); } };
  const key = (label, cls = '', fn) =>
    el('button', { class: `lock-key ${cls}`.trim(), onClick: fn || (() => press(label)) }, label);

  const pad = el('div', { class: 'lock-pad' });
  for (let i = 1; i <= 9; i++) pad.append(key(String(i)));
  pad.append(key('⌫', 'wide', () => { entered = entered.slice(0, -1); draw(); }));
  pad.append(key('0'));
  pad.append(key('✓', 'wide', submit));

  const screen = el('div', { class: 'lockscreen' }, [
    el('div', { class: 'lock-logo', text: 'P' }),
    el('h2', { text: title }),
    hint ? el('div', { class: 'hint', text: hint }) : null,
    dots, pad,
    onCancel ? el('button', { class: 'btn ghost', style: { marginTop: '6px' }, onClick: () => { screen.remove(); onCancel(); } }, 'Abbrechen') : null,
  ].filter(Boolean));
  const shake = () => { screen.classList.add('shake'); setTimeout(() => screen.classList.remove('shake'), 420); };
  function submit() {
    if (entered.length < 4) { shake(); return; }
    onSubmit(entered, { fail: () => { shake(); entered = ''; draw(); }, screen });
  }
  draw();
  return screen;
}

function showLock() {
  if (overlay) return;
  clearTimeout(idleTimer);
  overlay = padScreen({
    title: 'Ping ist gesperrt', hint: 'Gib deine PIN ein.',
    onSubmit: async (pin, { fail }) => {
      const ok = (await sha(pin, prefs.get('lockSalt'))) === prefs.get('lockHash');
      if (!ok) return fail();
      overlay.remove(); overlay = null; resetIdle();
    },
  });
  document.body.appendChild(overlay);
}

// ---- settings -------------------------------------------------------------
export function lockSettings() {
  const m = modal({ title: 'App-Sperre', width: '440px', body: (b) => render(b) });
  function render(b) {
    clear(b);
    b.append(
      setRow('shield', 'App-Sperre', {
        sub: lockEnabled() ? 'Ping fragt beim Öffnen nach deiner PIN.' : 'Schützt Ping auf diesem Gerät mit einer PIN.',
        trailing: switchEl(lockEnabled(), async (on) => {
          if (on) { await setupPin(); }
          else {
            if (!await confirmModal({ title: 'App-Sperre aus', message: 'PIN-Sperre auf diesem Gerät entfernen?', confirmText: 'Entfernen', danger: true })) { render(b); return; }
            prefs.set('lockEnabled', false); prefs.set('lockHash', ''); prefs.set('lockSalt', '');
            toast('App-Sperre entfernt.', 'ok');
          }
          render(b);
        }),
      }),
    );
    if (lockEnabled()) {
      b.append(
        setRow('lock', 'PIN ändern', { onClick: async () => { await setupPin(); render(b); } }),
        selectRow('Automatisch sperren', String(prefs.get('lockTimeoutMs') || 120000),
          [['30000', 'Nach 30 Sekunden'], ['120000', 'Nach 2 Minuten'], ['600000', 'Nach 10 Minuten'], ['0', 'Nur beim Start']],
          (v) => prefs.set('lockTimeoutMs', Number(v))),
      );
    }
  }

  function selectRow(label, value, options, onChange) {
    const sel = el('select', { class: 'input', style: { cursor: 'pointer' } },
      options.map(([v, t]) => el('option', { value: v, selected: v === value ? 'selected' : null }, t)));
    sel.addEventListener('change', () => { onChange(sel.value); toast('Gespeichert.', 'ok'); });
    return el('div', { class: 'field', style: { marginTop: '12px' } }, [el('label', { text: label }), sel]);
  }
}

// Capture a new PIN twice over a full-screen keypad; resolves once stored.
function setupPin() {
  return new Promise((resolve) => {
    let first = '';
    const stage1 = padScreen({
      title: 'Neue PIN', hint: '4–8 Ziffern.', onCancel: () => resolve(false),
      onSubmit: (pin, { screen }) => { first = pin; screen.remove(); document.body.appendChild(stage2); },
    });
    const stage2 = padScreen({
      title: 'PIN bestätigen', hint: 'Gib dieselbe PIN erneut ein.', onCancel: () => resolve(false),
      onSubmit: async (pin, { fail, screen }) => {
        if (pin !== first) { fail(); toast('PINs stimmen nicht überein.', 'err'); return; }
        const salt = randSalt();
        prefs.set('lockSalt', salt);
        prefs.set('lockHash', await sha(pin, salt));
        prefs.set('lockEnabled', true);
        screen.remove(); toast('App-Sperre aktiviert.', 'ok'); resolve(true);
      },
    });
    document.body.appendChild(stage1);
  });
}
