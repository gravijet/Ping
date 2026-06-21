/* infopanel.js — the slide-in panel on the right of a conversation. One calm,
   consistent place for "who/what is this chat": profile or group at a glance,
   shared media, and the handful of common actions (mute, disappearing, block).
   Deep group management (members, invite link, rename) is delegated to the
   existing groups.js modal so nothing is reimplemented or lost. */

import { api, authedObjectUrl } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, toast, lastSeenLabel } from './ui.js';
import { flag } from './flags.js';

let host = null; // { scrim, panel, chatId }

export function closeInfoPanel() {
  if (!host) return;
  const { scrim, panel } = host;
  panel.classList.remove('open');
  scrim.classList.remove('open');
  host = null;
  setTimeout(() => { panel.remove(); scrim.remove(); }, 220);
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e) { if (e.key === 'Escape') closeInfoPanel(); }

export function openInfoPanel(chat) {
  if (host && host.chatId === chat.id) return closeInfoPanel(); // toggle
  closeInfoPanel();
  const root = document.getElementById('modal-root');
  const scrim = el('div', { class: 'infopanel-scrim', onClick: closeInfoPanel });
  const body = el('div', { class: 'infopanel-body' });
  const panel = el('div', { class: 'infopanel' }, [
    el('div', { class: 'infopanel-head' }, [
      el('button', { class: 'iconbtn', title: 'Schließen', onClick: closeInfoPanel }, icon('close')),
      el('h3', { text: chat.type === 'group' ? 'Gruppeninfo' : 'Profil' }),
    ]),
    body,
  ]);
  root.append(scrim, panel);
  host = { scrim, panel, chatId: chat.id };
  requestAnimationFrame(() => { scrim.classList.add('open'); panel.classList.add('open'); });
  document.addEventListener('keydown', onKey, true);

  if (chat.type === 'group') renderGroup(body, chat);
  else renderDirect(body, chat);
}

// ---- direct: peer profile -------------------------------------------------
function renderDirect(body, chat) {
  const base = chat.otherUser || { id: chat.id, displayName: chat.title, avatarColor: chat.avatarColor };
  drawHero(body, base, chat.self ? 'Nur du' : (store.isOnline(base.id) ? 'online' : lastSeenLabel(store.state.lastSeen.get(base.id))));
  const fields = el('div');
  body.append(fields);
  sharedMedia(body, chat);
  extrasSection(body, chat);
  if (!chat.self) actionsDirect(body, chat, base);

  // Enrich from the server (mood, city, pronouns, birthday, about, phone).
  api.get(`/users/${base.id}`).then(({ user }) => {
    if (!user || !host) return;
    clear(fields);
    const rows = [];
    if (user.about) rows.push(['Info', user.about]);
    if (user.moodText) rows.push(['Stimmung', `${user.moodEmoji || ''} ${user.moodText}`.trim()]);
    if (user.phone) rows.push(['Telefon', user.phone]);
    if (user.city) rows.push(['Ort', user.city]);
    if (user.pronouns) rows.push(['Pronomen', user.pronouns]);
    if (user.birthday) rows.push(['Geburtstag', user.birthday]);
    if (rows.length) {
      fields.append(el('div', { class: 'ip-section', text: 'Über' }));
      for (const [k, v] of rows) fields.append(el('div', { class: 'ip-row' },
        [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]));
    }
  }).catch(() => {});
}

function actionsDirect(body, chat, peer) {
  body.append(el('div', { class: 'ip-section', text: 'Aktionen' }));
  body.append(muteRow(chat), disappearingRow(chat));
  const blockBtn = el('button', { class: 'btn ghost block', style: { marginTop: '12px' },
    onClick: toggleBlock }, [icon('block'), 'Blockieren']);
  body.append(blockBtn);
  let blocked = false;
  api.get('/blocks').then(({ blocked: ids }) => { blocked = (ids || []).includes(peer.id); paint(); }).catch(() => {});
  function paint() {
    clear(blockBtn).append(icon(blocked ? 'unblock' : 'block'),
      document.createTextNode(blocked ? 'Blockierung aufheben' : 'Blockieren'));
    blockBtn.classList.toggle('danger', !blocked);
    blockBtn.classList.toggle('ghost', blocked);
  }
  async function toggleBlock() {
    try {
      await api.post(`/users/${peer.id}/${blocked ? 'unblock' : 'block'}`);
      blocked = !blocked; paint(); toast(blocked ? 'Blockiert.' : 'Entsperrt.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }
}

// ---- group ----------------------------------------------------------------
function renderGroup(body, chat) {
  drawHero(body, { id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
    hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion },
    `${chat.members?.length || 0} Mitglieder`, 'chat');
  if (chat.description) body.append(el('p', { class: 'hint', style: { textAlign: 'center', lineHeight: '1.55' }, text: chat.description }));

  sharedMedia(body, chat);
  extrasSection(body, chat);

  body.append(el('div', { class: 'ip-section', text: 'Aktionen' }), muteRow(chat), disappearingRow(chat));

  body.append(el('div', { class: 'ip-section', text: 'Mitglieder' }));
  for (const u of (chat.members || []).slice(0, 6)) {
    body.append(el('button', { class: 'urow', onClick: () => import('./contacts.js').then((m) =>
      u.id !== store.state.me?.id && m.openProfile(u)) }, [
      avatar(u, 40, { online: store.isOnline(u.id), kind: 'user' }),
      el('div', { class: 'meta' }, [el('div', { class: 'uname', text: u.displayName }),
        u.id === chat.ownerId ? el('div', { class: 'uabout', text: 'Admin' }) : null].filter(Boolean)),
    ]));
  }
  body.append(el('button', { class: 'btn block', style: { marginTop: '10px' },
    onClick: () => { closeInfoPanel(); import('./groups.js').then((m) => m.openChatInfo(chat)); } },
    [icon('settings'), 'Mitglieder & Gruppe verwalten']));
  body.append(el('button', { class: 'btn danger block', style: { marginTop: '10px' },
    onClick: () => import('./groups.js').then((m) => m.leaveGroup(chat.id)) }, [icon('logout'), 'Gruppe verlassen']));
}

// ---- 0.34.0 "Alles": per-chat extras (notes, media hub, optics, E2EE, …) ---
function extrasSection(body, chat) {
  const rows = [];
  const add = (cond, iconName, label, fn) => { if (cond) rows.push(
    el('button', { class: 'btn ghost block', style: { marginTop: '8px' },
      onClick: () => fn() }, [icon(iconName), label])); };

  add(flag('chatMediaHub'), 'image', 'Geteilte Inhalte',
    () => import('./mediahub.js').then((m) => m.openMediaHub(chat.id)));
  add(flag('groupNotes'), 'tasks', 'Notizen',
    () => import('./notes.js').then((m) => m.openNotes(chat.id)));
  add(flag('chatThemes'), 'palette', 'Chat-Optik',
    () => import('./chatthemes.js').then((m) => m.chatAppearanceModal(chat.id)));
  add(flag('e2ee') && chat.type === 'direct' && !chat.self, 'lock', 'Verschlüsselung',
    () => import('./e2ee.js').then((m) => m.e2eePanel(chat.id)));
  add(flag('webhooks') && chat.type === 'group', 'bolt', 'Webhooks & Bots',
    () => import('./webhooks.js').then((m) => m.openWebhooks(chat.id)));
  add(flag('chatLock'), 'shield', 'Chat sperren',
    () => import('./chatlock.js').then((m) => m.chatLockModal(chat.id)));

  if (!rows.length) return;
  body.append(el('div', { class: 'ip-section', text: 'Mehr' }), ...rows);
}

// ---- shared bits ----------------------------------------------------------
function drawHero(body, entity, sub, kind = 'user') {
  body.append(el('div', { class: 'ip-hero' }, [
    avatar(entity, 96, { kind }),
    el('h2', { text: entity.displayName || entity.title || '' }),
    sub ? el('div', { class: 'sub', text: sub }) : null,
  ].filter(Boolean)));
}

function muteRow(chat) {
  const btn = el('button', { class: 'btn ghost block', onClick: toggle },
    [icon('mute'), chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten']);
  async function toggle() {
    try { await api.post(`/chats/${chat.id}/mute`, { muted: !chat.muted });
      chat.muted = !chat.muted; store.emit('chats');
      clear(btn).append(icon('mute'), document.createTextNode(chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten'));
    } catch (e) { toast(e.message, 'err'); }
  }
  return btn;
}

function disappearingRow(chat) {
  const opts = [['Aus', 0], ['1 Stunde', 3600], ['24 Stunden', 86400], ['7 Tage', 604800], ['90 Tage', 7776000]];
  const sel = el('select', { class: 'input', style: { cursor: 'pointer', marginTop: '8px' } },
    opts.map(([label, s]) => el('option', { value: s, selected: (chat.expireSeconds || 0) === s ? 'selected' : null }, label)));
  sel.addEventListener('change', async () => {
    try { const r = await api.post(`/chats/${chat.id}/expire`, { seconds: Number(sel.value) });
      if (r.chat) { Object.assign(chat, r.chat); store.upsertChat(chat); } toast('Aktualisiert.', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  return el('div', { class: 'field', style: { marginTop: '10px' } },
    [el('label', { text: 'Verschwindende Nachrichten' }), sel]);
}

function sharedMedia(body, chat) {
  const items = store.getHistory(chat.id)
    .filter((m) => !m.deleted && m.attachment && ['image', 'gif', 'video'].includes(m.attachment.kind))
    .map((m) => m.attachment);
  if (!items.length) return;
  body.append(el('div', { class: 'ip-section', text: `Medien (${items.length})` }));
  const grid = el('div', { class: 'ip-media-grid' });
  // Newest first, cap the preview.
  const shown = items.slice(-12).reverse();
  shown.forEach((att, i) => {
    const cell = el('img', { alt: att.name || '' });
    authedObjectUrl(att.url).then((u) => { if (u) cell.src = u; });
    cell.addEventListener('click', () => import('./gallery.js').then((m) =>
      m.openGallery(shown, i)));
    grid.append(cell);
  });
  body.append(grid);
}
