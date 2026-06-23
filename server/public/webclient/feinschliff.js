/* feinschliff.js — 0.37.0 "Feinschliff": small, self-contained UI helpers for the
   curated polish features. Each is flag-gated by its caller. No build step. */

import { el, icon, modal, avatar, toast } from './ui.js';
import { api } from './api.js';
import { flag } from './flags.js';

// ---- sendEffects ----------------------------------------------------------

const EFFECTS = {
  confetti: { label: 'Konfetti', glyphs: ['🎉', '🎊', '✨', '🥳'] },
  balloons: { label: 'Ballons', glyphs: ['🎈', '🎈', '🎈'] },
  hearts:   { label: 'Herzen', glyphs: ['❤️', '💖', '💕', '💗'] },
};

export function effectLabel(name) { return EFFECTS[name]?.label || ''; }
export function effectNames() { return Object.keys(EFFECTS); }

// Play a one-shot full-screen particle burst, then tidy up. Respects
// prefers-reduced-motion (does nothing) so it never becomes a nuisance.
export function playEffect(name) {
  const spec = EFFECTS[name];
  if (!spec) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = el('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  const N = name === 'balloons' ? 14 : 26;
  for (let i = 0; i < N; i++) {
    const g = spec.glyphs[i % spec.glyphs.length];
    const p = el('span', { class: `fx-bit fx-${name}`, text: g, style: {
      left: Math.random() * 100 + 'vw',
      animationDelay: (Math.random() * 0.5).toFixed(2) + 's',
      animationDuration: (1.8 + Math.random() * 1.2).toFixed(2) + 's',
      fontSize: (18 + Math.random() * 20).toFixed(0) + 'px',
    } });
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}

// A tiny menu anchored to the composer's effect button. Calls back with the
// chosen effect name (or '' to clear).
export function effectMenu(onPick, current = '') {
  const close = modal({
    title: 'Effekt beim Senden',
    body: (b) => {
      const row = el('div', { class: 'fx-pick' });
      const mk = (name, label) => el('button', {
        class: `fx-choice ${current === name ? 'on' : ''}`,
        onClick: () => { onPick(name); close.close(); if (name) playEffect(name); },
      }, [el('span', { class: 'fx-emoji', text: name ? EFFECTS[name].glyphs[0] : '🚫' }),
          el('span', { text: label })]);
      row.append(
        mk('', 'Kein Effekt'),
        ...Object.entries(EFFECTS).map(([k, v]) => mk(k, v.label)),
      );
      b.appendChild(row);
    },
  });
  return close;
}

// ---- voiceDictation -------------------------------------------------------

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
export const dictationSupported = () => !!SR;

// Toggle on-device dictation into a textarea. Returns a stop() fn; calling the
// returned starter again (via the button) stops it. Best-effort: any failure
// degrades silently to "not available".
export function startDictation(ta, btn) {
  if (!SR) { toast('Diktat wird hier nicht unterstützt.'); return null; }
  let rec;
  try { rec = new SR(); } catch { return null; }
  rec.lang = (navigator.language || 'de-DE');
  rec.interimResults = true;
  rec.continuous = true;
  const base = ta.value ? ta.value + ' ' : '';
  rec.onresult = (e) => {
    let txt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
    ta.value = base + txt;
    ta.dispatchEvent(new Event('input'));
  };
  rec.onend = () => btn?.classList.remove('rec');
  rec.onerror = () => btn?.classList.remove('rec');
  try { rec.start(); btn?.classList.add('rec'); } catch { return null; }
  return () => { try { rec.stop(); } catch {} };
}

// ---- reactionDetails ------------------------------------------------------

// Open a sheet listing everyone who reacted to a message, grouped by emoji.
export async function openReactionDetails(chatId, m) {
  if (!flag('reactionDetails')) return;
  let groups = [];
  try { groups = (await api.get(`/chats/${chatId}/messages/${m.id}/reactions`)).reactions || []; }
  catch { /* fall back to the local counts below */ }
  modal({
    title: 'Reaktionen',
    body: (b) => {
      if (!groups.length) { b.appendChild(el('div', { class: 'empty', text: 'Noch keine Reaktionen.' })); return; }
      for (const g of groups) {
        b.appendChild(el('div', { class: 'react-grp-h' },
          [el('span', { class: 'react-grp-emoji', text: g.emoji }),
           el('span', { class: 'muted', text: `${g.users.length}` })]));
        for (const u of g.users) {
          b.appendChild(el('div', { class: 'react-grp-u' },
            [avatar(u, 30, { kind: 'user' }), el('span', { text: u.displayName })]));
        }
      }
    },
  });
}

// ---- anniversaries --------------------------------------------------------

// Fetch upcoming birthdays/anniversaries among the user's contacts (best-effort).
export async function loadAnniversaries() {
  if (!flag('anniversaries')) return [];
  try { return (await api.get('/me/anniversaries')).anniversaries || []; }
  catch { return []; }
}

export function anniversaryText(a) {
  const name = a.user?.displayName || 'Jemand';
  if (a.inDays === 0) return `🎂 ${name} hat heute Geburtstag!`;
  if (a.inDays === 1) return `🎂 ${name} hat morgen Geburtstag.`;
  return `🎂 ${name} hat in ${a.inDays} Tagen Geburtstag.`;
}
