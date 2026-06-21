/* mediahub.js — shared media / files / links gallery per chat (0.34.0). Pure view
   over existing messages (server route /chats/:id/media?kind=…); no new storage.
   Tabs: Bilder · Videos · Dateien · Links. Opened from the info panel. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast } from './ui.js';
import { renderAttachment } from './media.js';
import { firstUrl } from './linkpreview.js';

const TABS = [['image', 'Bilder'], ['video', 'Videos'], ['file', 'Dateien'], ['link', 'Links']];

export function openMediaHub(chatId, kind = 'image') {
  const tabsBar = el('div', { class: 'mh-tabs' });
  const content = el('div', { class: 'mh-content' });
  modal({
    title: 'Geteilte Inhalte',
    width: '520px',
    body: (b) => b.append(tabsBar, content),
  });
  let active = kind;
  for (const [k, label] of TABS) {
    tabsBar.append(el('button', { class: `mh-tab ${k === active ? 'on' : ''}`, dataset: { k },
      onClick: () => { active = k; for (const t of tabsBar.children) t.classList.toggle('on', t.dataset.k === k); load(k); } }, label));
  }
  load(active);

  async function load(k) {
    clear(content).append(el('div', { class: 'hint', text: 'Lade …' }));
    let messages = [];
    try { ({ messages } = await api.get(`/chats/${chatId}/media?kind=${k}`)); }
    catch { clear(content).append(el('div', { class: 'pane-empty', text: 'Konnte nicht geladen werden.' })); return; }
    clear(content);
    if (!messages.length) { content.append(el('div', { class: 'pane-empty', text: 'Nichts gefunden.' })); return; }
    if (k === 'image' || k === 'video') {
      const grid = el('div', { class: 'mh-grid' });
      for (const m of messages) if (m.attachment) grid.append(el('div', { class: 'mh-cell' }, renderAttachment(m.attachment)));
      content.append(grid);
    } else if (k === 'link') {
      const list = el('div', { class: 'mh-links' });
      for (const m of messages) {
        const u = firstUrl(m.body || '');
        if (!u) continue;
        list.append(el('a', { class: 'mh-link', href: u, target: '_blank', rel: 'noopener' }, [icon('link', 'sm'), el('span', { text: u })]));
      }
      content.append(list.children.length ? list : el('div', { class: 'pane-empty', text: 'Keine Links.' }));
    } else {
      const list = el('div', { class: 'mh-files' });
      for (const m of messages) if (m.attachment) list.append(renderAttachment(m.attachment));
      content.append(list);
    }
  }
}
