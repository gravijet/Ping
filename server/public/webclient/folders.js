/* folders.js — chat folders (0.27.0 "Ordnung & Ausdruck"). Folders group
   conversations into filter tabs above the chat list. Create/rename/delete and
   per-folder chat assignment all live here; the server persists them and pushes
   `folders-updated` to the user's other devices, so the tabs stay in sync.

   store.state.folders holds the live list; mutating calls re-emit 'folders' so
   the filter bar re-renders. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, confirmModal } from './ui.js';
import { flag } from './flags.js';

const MAX = 20;

/** Fetch the user's folders into the store (best-effort; offline keeps cache). */
export async function loadFolders() {
  try {
    const { folders } = await api.get('/me/folders');
    if (Array.isArray(folders)) store.state.folders = folders;
  } catch { /* offline — keep whatever we already have */ }
  return store.state.folders || [];
}

/** Apply a server-pushed folder list (another device changed it). */
export function applyFolders(folders) {
  if (Array.isArray(folders)) { store.state.folders = folders; store.emit('folders'); }
}

export function openFolderManager() {
  modal({ title: 'Ordner', width: '480px', body: (body) => paint(body) });
}

function paint(body) {
  clear(body);
  const folders = store.state.folders || [];
  const list = el('div', { class: 'folder-list' });
  if (!folders.length) {
    list.appendChild(el('div', { class: 'pane-empty',
      text: 'Noch keine Ordner. Lege einen an, um deine Chats zu gruppieren.' }));
  }
  for (const f of folders) {
    const sub = f.rule
      ? `Auto: „${f.rule.keyword}" · ${f.chatIds.length} ${f.chatIds.length === 1 ? 'Chat' : 'Chats'}`
      : `${f.chatIds.length} ${f.chatIds.length === 1 ? 'Chat' : 'Chats'}`;
    list.appendChild(el('div', { class: 'folder-row' }, [
      el('div', { class: 'folder-meta' }, [
        el('span', { class: 'folder-emoji', text: f.emoji || '🗂️' }),
        el('div', {}, [
          el('div', { class: 'folder-name', text: f.name }),
          el('div', { class: 'folder-sub', text: sub }),
        ]),
      ]),
      el('div', { class: 'folder-actions' }, [
        el('button', { class: 'iconbtn', title: 'Chats zuordnen', 'aria-label': 'Chats zuordnen',
          onClick: () => assignChats(f, body) }, icon('check')),
        flag('smartFolders')
          ? el('button', { class: `iconbtn ${f.rule ? 'on' : ''}`, title: 'Auto-Regel', 'aria-label': 'Auto-Regel',
              onClick: () => ruleForm(f, body) }, icon('bolt'))
          : null,
        el('button', { class: 'iconbtn', title: 'Umbenennen', 'aria-label': 'Umbenennen',
          onClick: () => folderForm(f).then((d) => d && saveEdit(f.id, d, body)) }, icon('edit')),
        el('button', { class: 'iconbtn', title: 'Löschen', 'aria-label': 'Löschen',
          onClick: () => removeFolder(f, body) }, icon('trash')),
      ].filter(Boolean)),
    ]));
  }
  body.append(list);
  body.appendChild(el('button', {
    class: 'btn primary block', disabled: folders.length >= MAX,
    title: folders.length >= MAX ? `Höchstens ${MAX} Ordner` : '',
    onClick: () => folderForm().then((d) => d && createFolder(d, body)),
  }, [icon('plus', 'sm'), el('span', { text: 'Neuen Ordner anlegen' })]));
}

// A small name + emoji form. Resolves to { name, emoji } or null on cancel.
function folderForm(initial) {
  return new Promise((resolve) => {
    let done = false;
    const emojiInput = el('input', { class: 'input folder-emoji-input', maxlength: '8',
      placeholder: '🗂️', value: initial?.emoji || '' });
    const nameInput = el('input', { class: 'input', maxlength: '40',
      placeholder: 'Ordnername', value: initial?.name || '' });
    const m = modal({
      title: initial ? 'Ordner umbenennen' : 'Neuer Ordner',
      width: '400px',
      onClose: () => { if (!done) resolve(null); },
      body: el('div', { class: 'folder-form' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Symbol' }), emojiInput]),
        el('label', { class: 'field' }, [el('span', { text: 'Name' }), nameInput]),
      ]),
      foot: [
        el('button', { class: 'btn ghost', onClick: () => { m.close(); } }, 'Abbrechen'),
        el('button', { class: 'btn primary', onClick: () => {
          const name = nameInput.value.trim();
          if (!name) { toast('Bitte gib einen Namen ein.', 'err'); nameInput.focus(); return; }
          done = true; m.close(); resolve({ name, emoji: emojiInput.value.trim() });
        } }, 'Speichern'),
      ],
    });
    setTimeout(() => nameInput.focus(), 0);
  });
}

// 0.37.0 "Feinschliff": smartFolders — a keyword auto-sort rule. Chats whose
// title contains the keyword are pulled into the folder automatically (on top of
// any manually-assigned chats). An empty keyword clears the rule.
function ruleForm(f, body) {
  const kw = el('input', { class: 'input', maxlength: '60',
    placeholder: 'z. B. „Arbeit" oder ein Name', value: f.rule?.keyword || '' });
  const m = modal({
    title: `Auto-Regel · „${f.name}"`,
    width: '420px',
    body: el('div', { class: 'folder-form' }, [
      el('div', { class: 'hint', text: 'Chats, deren Titel dieses Stichwort enthält, landen automatisch in diesem Ordner.' }),
      el('label', { class: 'field' }, [el('span', { text: 'Stichwort' }), kw]),
    ]),
    foot: [
      f.rule
        ? el('button', { class: 'btn ghost', onClick: () => save('') }, 'Regel entfernen')
        : null,
      el('button', { class: 'btn primary', onClick: () => save(kw.value.trim()) }, 'Speichern'),
    ].filter(Boolean),
  });
  setTimeout(() => kw.focus(), 0);
  async function save(keyword) {
    try {
      const payload = keyword ? { kind: 'keyword', keyword } : { kind: 'all' };
      const r = await api.put(`/me/folders/${f.id}/rule`, payload);
      if (Array.isArray(r.folders)) store.state.folders = r.folders;
      m.close();
      store.emit('folders'); store.emit('chats');
      if (body) paint(body);
      toast(keyword ? 'Auto-Regel gespeichert.' : 'Auto-Regel entfernt.', 'ok');
    } catch (e) { toast(e.message || 'Speichern fehlgeschlagen.', 'err'); }
  }
}

async function createFolder(data, body) {
  try {
    await api.post('/me/folders', data);
    await reload(body);
    toast('Ordner angelegt.');
  } catch (e) { toast(e.message || 'Ordner konnte nicht angelegt werden.', 'err'); }
}

async function saveEdit(id, data, body) {
  try { await api.patch(`/me/folders/${id}`, data); await reload(body); }
  catch (e) { toast(e.message || 'Speichern fehlgeschlagen.', 'err'); }
}

async function removeFolder(f, body) {
  if (!(await confirmModal({ title: 'Ordner löschen?',
    message: `„${f.name}" wird entfernt. Deine Chats bleiben erhalten.`,
    confirmText: 'Löschen', danger: true }))) return;
  try {
    await api.del(`/me/folders/${f.id}`);
    // If the deleted folder was the active filter, fall back to "Alle".
    if (store.state.chatFilter === 'folder:' + f.id) store.state.chatFilter = 'all';
    await reload(body);
  } catch (e) { toast(e.message || 'Löschen fehlgeschlagen.', 'err'); }
}

// A checkbox list of every chat, pre-ticked with the folder's current members.
// Saving replaces the folder's chat set (PUT) and refreshes the manager + tabs.
function assignChats(f, body) {
  const chats = store.chatsSorted().filter((c) => !c.archived);
  const picked = new Set(f.chatIds);
  const rows = el('div', { class: 'folder-pick' }, chats.map((c) => {
    const cb = el('input', { type: 'checkbox', checked: picked.has(c.id) });
    cb.addEventListener('change', () => { cb.checked ? picked.add(c.id) : picked.delete(c.id); });
    return el('label', { class: 'folder-pick-row' }, [
      cb,
      avatar(c.type === 'group'
        ? { id: c.id, title: c.title, avatarColor: c.avatarColor, hasAvatar: c.hasAvatar, avatarVersion: c.avatarVersion }
        : (c.otherUser || { id: c.id, displayName: c.title, avatarColor: c.avatarColor }),
        34, { kind: c.type === 'group' ? 'chat' : 'user' }),
      el('span', { class: 'folder-pick-name', text: c.self ? 'Notiz an mich' : c.title }),
    ]);
  }));
  const inner = modal({
    title: `„${f.name}" · Chats`,
    width: '420px',
    body: chats.length ? rows : el('div', { class: 'pane-empty', text: 'Keine Chats vorhanden.' }),
    foot: [
      el('button', { class: 'btn ghost', onClick: () => inner.close() }, 'Abbrechen'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          await api.put(`/me/folders/${f.id}/chats`, { chatIds: [...picked] });
        } catch (e) { toast(e.message || 'Speichern fehlgeschlagen.', 'err'); return; }
        inner.close();
        await reload(body);
      } }, 'Speichern'),
    ],
  });
}

async function reload(body) {
  await loadFolders();
  store.emit('folders');
  store.emit('chats');
  if (body) paint(body);
}
