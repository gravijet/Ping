/* gifsearch.js — GIF search (0.34.0), proxied through the server so the GIF
   provider never sees the client (private). Degrades gracefully when no provider
   key is configured server-side ({ available:false }). Sends the pick as a normal
   'gif' message. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast } from './ui.js';

export function openGifPicker(chatId) {
  const input = el('input', { class: 'input', placeholder: 'GIFs suchen …', autofocus: 'autofocus' });
  const grid = el('div', { class: 'gif-grid' });
  const dlg = modal({
    title: 'GIF',
    width: '460px',
    body: (b) => b.append(el('div', { class: 'field' }, input), grid),
  });
  setTimeout(() => input.focus(), 50);
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(input.value.trim()), 350); });
  search('');
  async function search(q) {
    clear(grid).append(el('div', { class: 'hint', text: q ? 'Suche …' : 'Tippe einen Suchbegriff.' }));
    if (!q) return;
    let r;
    try { r = await api.get(`/gifs/search?q=${encodeURIComponent(q)}`); }
    catch { clear(grid).append(el('div', { class: 'pane-empty', text: 'GIF-Suche fehlgeschlagen.' })); return; }
    clear(grid);
    if (!r.available) { grid.append(el('div', { class: 'pane-empty', text: 'GIF-Suche ist nicht konfiguriert.' })); return; }
    if (!r.results?.length) { grid.append(el('div', { class: 'pane-empty', text: 'Keine Treffer.' })); return; }
    for (const g of r.results) {
      const img = el('img', { class: 'gif-thumb', src: g.preview || g.url, alt: g.desc || '', loading: 'lazy' });
      grid.append(el('button', { class: 'gif-cell', title: g.desc || '',
        onClick: () => { dlg.close(); sendGif(chatId, g); } }, img));
    }
  }
}

async function sendGif(chatId, g) {
  try {
    const { message } = await api.post(`/chats/${chatId}/messages`, {
      type: 'gif',
      attachment: { kind: 'gif', url: g.url, name: (g.desc || 'gif') + '.gif' },
    });
    store.addMessage(chatId, message);
  } catch (e) { toast(e.message || 'GIF konnte nicht gesendet werden.', 'err'); }
}
