/* saved.js — the "Gespeichert" list-pane section. Two things live here:
   markierte (starred) messages — kept per device, like the mobile app's local
   star store — and a shortcut to "Notiz an mich" (the self-chat). Clicking a
   starred item jumps to that chat. */

import { api } from './api.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, chatTime, toast } from './ui.js';

let prefsUnsub = null;

export async function renderSavedPane(head, body, openChat) {
  clear(head).append(el('div', { class: 'pane-title', text: 'Gespeichert' }));
  paint(body, openChat);
  // Re-render when stars change elsewhere. Drop the previous render's listener so
  // re-entering the pane doesn't pile up stale closures pinning old containers.
  prefsUnsub?.();
  prefsUnsub = store.on('prefs', () => { if (document.body.contains(body)) paint(body, openChat); });
}

function paint(body, openChat) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.appendChild(scroll);

  // Self-chat shortcut ("Notiz an mich").
  const self = store.chatsSorted().find((c) => c.self);
  scroll.appendChild(el('button', { class: 'urow', onClick: () => openSelfNote(openChat) }, [
    el('div', { class: 'set-ic', style: { width: '48px', height: '48px', borderRadius: '50%' } },
      icon('edit')),
    el('div', { class: 'meta' }, [
      el('div', { class: 'uname', text: 'Notiz an mich' }),
      el('div', { class: 'uabout', text: 'Notizen, Links und Dateien nur für dich' }),
    ]),
  ]));

  scroll.appendChild(el('div', { class: 'pane-section' }, [icon('star'), el('span', { text: 'Markierte Nachrichten' })]));
  const entries = prefs.starredEntries();
  if (!entries.length) {
    scroll.appendChild(el('div', { class: 'pane-empty',
      text: 'Noch nichts markiert. Tippe in einem Chat auf „Markieren", um Nachrichten hier zu sammeln.' }));
    return;
  }
  for (const it of entries) {
    const chat = store.getChat(it.chatId);
    scroll.appendChild(el('div', { class: 'urow', onClick: () => openChat(it.chatId) }, [
      el('div', { class: 'set-ic', style: { width: '48px', height: '48px', borderRadius: '14px', color: 'var(--warn)' } },
        icon('star', 'fill')),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: it.preview || 'Nachricht' }),
        el('div', { class: 'uabout', text: `${it.senderName || ''} · ${it.chatTitle || chat?.title || ''} · ${chatTime(it.createdAt)}` }),
      ]),
      el('button', { class: 'iconbtn', title: 'Markierung entfernen', onClick: (e) => {
        e.stopPropagation(); prefs.toggleStar(it.chatId, it.msgId); store.emit('prefs'); } }, icon('close')),
    ]));
  }
}

async function openSelfNote(openChat) {
  const existing = store.chatsSorted().find((c) => c.self);
  if (existing) return openChat(existing.id);
  // Create the self-chat on demand (direct chat with myself).
  try {
    const { chat } = await api.post('/chats/direct', { userId: store.state.me.id });
    store.upsertChat(chat);
    openChat(chat.id);
  } catch (e) { toast(e.message || 'Konnte „Notiz an mich" nicht öffnen.', 'err'); }
}
