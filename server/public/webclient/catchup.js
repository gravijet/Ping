/* catchup.js — "Hol mich ab" (0.34.0). A purely local/extractive unread summary
   computed server-side without any LLM (frequency + representative lines), so it
   stays 100% private. Shows a quick digest of what you missed in a chat. */

import { api } from './api.js';
import { el, clear, icon, modal } from './ui.js';
import * as store from './store.js';

export async function openCatchUp(chatId) {
  const chat = store.getChat(chatId);
  const since = chat?.lastReadAt || chat?.seenUpTo || 0;
  const body = el('div', { class: 'catchup' }, el('div', { class: 'hint', text: 'Fasse zusammen …' }));
  modal({ title: 'Hol mich ab', width: '440px', body: (b) => b.append(body) });
  try {
    const { summary } = await api.get(`/chats/${chatId}/catchup?since=${since}`);
    clear(body);
    if (!summary || !summary.count) {
      body.append(el('div', { class: 'pane-empty', text: 'Nichts Neues — du bist auf dem Laufenden. 🎉' }));
      return;
    }
    body.append(el('div', { class: 'catchup-head' }, [icon('bolt'), el('span', { text: summary.text })]));
    if (summary.keywords?.length) {
      body.append(el('div', { class: 'catchup-tags' },
        summary.keywords.map((k) => el('span', { class: 'tag', text: k }))));
    }
    if (summary.snippets?.length) {
      const ul = el('div', { class: 'catchup-lines' });
      for (const s of summary.snippets) ul.append(el('div', { class: 'catchup-line', text: '› ' + s }));
      body.append(ul);
    }
  } catch {
    clear(body);
    body.append(el('div', { class: 'pane-empty', text: 'Zusammenfassung nicht verfügbar.' }));
  }
}
