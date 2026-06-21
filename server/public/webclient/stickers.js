/* stickers.js — sticker packs (0.34.0). A 'sticker' message is a normal message
   whose attachment is { kind:'sticker', url, emoji }. This module renders the
   in-bubble sticker and the picker (browse your packs → send; create packs and
   add stickers from an image upload). */

import { api, uploadFile, authedObjectUrl } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast } from './ui.js';
import { pickFile } from './media.js';

/** Render a sticker bubble (transparent, no chrome) for message [m]. */
export function renderSticker(m) {
  const att = m.attachment || {};
  const img = el('img', { class: 'sticker-img', alt: att.emoji || 'Sticker', loading: 'lazy', decoding: 'async' });
  if (att.url) authedObjectUrl(att.url).then((u) => { if (u) img.src = u; });
  return el('div', { class: 'sticker-wrap' }, img);
}

/** Open the sticker picker for [chatId]. */
export async function openStickerPicker(chatId) {
  const grid = el('div', { class: 'sticker-grid' });
  const dlg = modal({
    title: 'Sticker',
    width: '420px',
    body: (b) => b.append(grid),
    foot: [
      el('button', { class: 'btn ghost', onClick: () => managePacks(() => load()) }, [icon('plus'), 'Pakete verwalten']),
    ],
  });
  load();
  async function load() {
    clear(grid).append(el('div', { class: 'hint', text: 'Lade …' }));
    let packs = [];
    try { ({ packs } = await api.get('/stickers/packs')); } catch { /* offline */ }
    clear(grid);
    const all = (packs || []).flatMap((p) => p.stickers || []);
    if (!all.length) {
      grid.append(el('div', { class: 'pane-empty', text: 'Noch keine Sticker. Lege über „Pakete verwalten" eines an.' }));
      return;
    }
    for (const s of all) {
      const img = el('img', { class: 'sticker-pick', alt: s.emoji || '', loading: 'lazy' });
      if (s.url) authedObjectUrl(s.url).then((u) => { if (u) img.src = u; });
      grid.append(el('button', { class: 'sticker-cell', title: s.emoji || 'Sticker',
        onClick: () => { dlg.close(); send(chatId, s.id); } }, img));
    }
  }
}

async function send(chatId, stickerId) {
  try {
    const { message } = await api.post(`/chats/${chatId}/stickers`, { stickerId });
    store.addMessage(chatId, message);
  } catch (e) { toast(e.message || 'Sticker konnte nicht gesendet werden.', 'err'); }
}

/** Manage packs: create a pack, add stickers from an uploaded image. */
function managePacks(onChange) {
  const list = el('div', { class: 'pack-list' });
  const dlg = modal({
    title: 'Sticker-Pakete',
    width: '440px',
    body: (b) => b.append(list),
    foot: [el('button', { class: 'btn primary', onClick: newPack }, [icon('plus'), 'Neues Paket'])],
    onClose: onChange,
  });
  paint();
  async function paint() {
    clear(list).append(el('div', { class: 'hint', text: 'Lade …' }));
    let packs = [];
    try { ({ packs } = await api.get('/stickers/packs')); } catch { /* offline */ }
    clear(list);
    if (!packs?.length) { list.append(el('div', { class: 'pane-empty', text: 'Noch keine Pakete.' })); return; }
    for (const p of packs) {
      const thumbs = el('div', { class: 'pack-thumbs' });
      for (const s of p.stickers || []) {
        const img = el('img', { class: 'pack-thumb', loading: 'lazy' });
        if (s.url) authedObjectUrl(s.url).then((u) => { if (u) img.src = u; });
        thumbs.append(img);
      }
      list.append(el('div', { class: 'pack-row' }, [
        el('div', { class: 'pack-meta' }, [
          el('div', { class: 'pack-name', text: p.name }),
          thumbs,
        ]),
        el('button', { class: 'btn ghost sm', onClick: () => addSticker(p.id, paint) }, [icon('plus'), 'Sticker']),
      ]));
    }
  }
  async function newPack() {
    const name = prompt('Name des Pakets?');
    if (!name) return;
    try { await api.post('/stickers/packs', { name: name.trim() }); paint(); }
    catch (e) { toast(e.message || 'Fehlgeschlagen.', 'err'); }
  }
}

async function addSticker(packId, done) {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    toast('Lädt hoch …');
    // uploadFile returns the upload meta { id, url, … }; we need the id.
    const meta = await uploadFile(file);
    const emoji = prompt('Emoji für diesen Sticker? (optional)') || '';
    await api.post(`/stickers/packs/${packId}/stickers`, { uploadId: meta.id, emoji: emoji.trim() });
    toast('Sticker hinzugefügt.', 'ok');
    done?.();
  } catch (e) { toast(e.message || 'Hinzufügen fehlgeschlagen.', 'err'); }
}
