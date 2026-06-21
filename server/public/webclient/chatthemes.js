/* chatthemes.js — per-chat appearance (0.34.0). A member can set a wallpaper +
   accent for a chat; it's stored server-side per (user, chat) so it follows them
   across devices. We apply it as CSS custom properties / a background on the
   conversation pane. */

import { api } from './api.js';
import * as store from './store.js';
import { el, modal, toast } from './ui.js';

const WALLPAPERS = [
  ['', 'Standard'],
  ['linear-gradient(135deg,#1e3a8a,#0f172a)', 'Mitternacht'],
  ['linear-gradient(135deg,#065f46,#022c22)', 'Wald'],
  ['linear-gradient(135deg,#7c2d12,#1c1917)', 'Sonnenuntergang'],
  ['linear-gradient(135deg,#4c1d95,#1e1b4b)', 'Violett'],
  ['radial-gradient(circle at 30% 20%,#0ea5e9,#0c4a6e)', 'Ozean'],
];

const cache = new Map(); // chatId -> appearance

/** Fetch + apply the saved appearance for [chatId] to the conversation pane. */
export async function applyChatAppearance(chatId) {
  let appearance = cache.get(chatId);
  if (!appearance) {
    try { ({ appearance } = await api.get(`/chats/${chatId}/appearance`)); cache.set(chatId, appearance || {}); }
    catch { appearance = {}; }
  }
  paint(chatId, appearance || {});
}

function paint(chatId, a) {
  if (store.state.activeId !== chatId) return;
  const pane = document.querySelector('.conversation, .chat-pane, #chat-pane') || document.querySelector('.thread')?.parentNode;
  if (!pane) return;
  pane.style.setProperty('--chat-wallpaper', a.wallpaper || 'transparent');
  pane.classList.toggle('has-wallpaper', !!a.wallpaper);
  if (a.accent) pane.style.setProperty('--accent', a.accent.startsWith('#') ? a.accent : '#' + a.accent);
  else pane.style.removeProperty('--accent');
}

/** Appearance editor for [chatId]. */
export function chatAppearanceModal(chatId) {
  const current = cache.get(chatId) || {};
  const sel = el('select', { class: 'input' },
    WALLPAPERS.map(([v, l]) => el('option', { value: v, selected: v === (current.wallpaper || '') ? 'selected' : null }, l)));
  const accent = el('input', { class: 'input', type: 'color', value: current.accent ? (current.accent.startsWith('#') ? current.accent : '#' + current.accent) : '#3b82f6' });
  const m = modal({
    title: 'Chat-Optik',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Hintergrund' }), sel]),
      el('div', { class: 'field' }, [el('label', { text: 'Akzentfarbe' }), accent]),
      el('p', { class: 'hint', text: 'Gilt nur für dich, auf allen deinen Geräten.' }),
    ),
    foot: [
      el('button', { class: 'btn ghost', onClick: () => save({ wallpaper: null, accent: null }) }, 'Zurücksetzen'),
      el('button', { class: 'btn primary', onClick: () => save({ wallpaper: sel.value || null, accent: accent.value }) }, 'Speichern'),
    ],
  });
  async function save(payload) {
    try {
      const { appearance } = await api.put(`/chats/${chatId}/appearance`, payload);
      cache.set(chatId, appearance || {});
      paint(chatId, appearance || {});
      m.close();
    } catch (e) { toast(e.message || 'Speichern fehlgeschlagen.', 'err'); }
  }
}
