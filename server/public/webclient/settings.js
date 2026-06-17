/* settings.js — the user's account + app settings, organised into tabs:
   Profil · Datenschutz · Design · Mitteilungen · Mehr. Server-backed settings
   (profile, privacy, password, message storage, blocking, export) go through
   /api; device-side preferences (theme, accent, wallpaper, accessibility) live
   in prefs.js and re-theme the whole client instantly. */

import { api, authedObjectUrl } from './api.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, modal, toast, switchEl, setRow } from './ui.js';
import { pickFile } from './media.js';
import { doLogout } from './app.js';

const TABS = ['Profil', 'Datenschutz', 'Design', 'Mitteilungen', 'Mehr'];

export function openSettings() {
  let tab = 'Profil';
  // `modal()` runs the body callback synchronously, before the handle is
  // assigned — so close lazily through a holder rather than capturing it now.
  const ctx = {};
  const closeModal = () => ctx.modal && ctx.modal.close();
  ctx.modal = modal({ title: 'Einstellungen', width: '520px', body: (body) => {
    const seg = el('div', { class: 'seg', style: { flexWrap: 'wrap', marginBottom: '10px' } },
      TABS.map((t) => el('button', { class: t === tab ? 'on' : '',
        onClick: () => { tab = t; render(); } }, t)));
    const content = el('div');
    body.append(seg, content);

    function render() {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === tab));
      clear(content);
      if (tab === 'Profil') profileTab(content);
      else if (tab === 'Datenschutz') privacyTab(content);
      else if (tab === 'Design') designTab(content);
      else if (tab === 'Mitteilungen') notifyTab(content);
      else moreTab(content, closeModal);
    }
    render();
  } });
}

// ---- Profil ---------------------------------------------------------------
function profileTab(c) {
  const me = store.state.me;
  const banner = el('div', { class: 'profile-banner', title: 'Banner ändern',
    style: { cursor: 'pointer' }, onClick: changeBanner });
  if (me.hasBanner) authedObjectUrl(`/users/${me.id}/banner`, me.bannerVersion || 0)
    .then((u) => u && (banner.style.backgroundImage = `url(${u})`));

  const avBox = el('div', { style: { position: 'relative', cursor: 'pointer' },
    onClick: changeAvatar, title: 'Profilbild ändern' }, avatar(me, 92, { kind: 'user' }));
  avBox.appendChild(el('div', { style: { position: 'absolute', right: '0', bottom: '0',
    background: 'var(--accent)', borderRadius: '50%', width: '30px', height: '30px',
    display: 'grid', placeItems: 'center', border: '3px solid var(--glass)' } }, icon('camera', 'sm')));

  c.append(
    banner,
    el('div', { class: 'profile-pane' }, [avBox,
      el('h3', { text: me.displayName }), el('div', { class: 'hint', text: me.phone })]),
    editRow('Name', me.displayName, (v) => save({ displayName: v })),
    editRow('Info', me.about || '', (v) => save({ about: v }), 'Hey, ich nutze Ping!'),
    editRow('Ort', me.city || '', (v) => save({ city: v })),
    editRow('Pronomen', me.pronouns || '', (v) => save({ pronouns: v }), 'z. B. sie/ihr'),
    el('div', { class: 'list-section', text: 'Konto' }),
    el('div', { class: 'profile-row inline' }, [el('span', { class: 'k', text: 'E-Mail' }),
      el('span', { class: 'v', text: me.email })]),
    setRow('lock', 'Passwort ändern', { onClick: changePassword }),
  );

  async function save(patch) {
    try { const { user } = await api.patch('/me', patch); store.state.me = user;
      store.emit('me-updated'); toast('Gespeichert.', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function changeAvatar() {
    const file = await pickFile('image/*'); if (!file) return;
    try { const buf = await file.arrayBuffer();
      await api.post('/me/avatar', buf, { raw: true, headers: { 'Content-Type': file.type || 'image/jpeg' } });
      const { user } = await api.get('/me'); store.state.me = user; store.emit('me-updated');
      clear(c); profileTab(c); toast('Profilbild aktualisiert.', 'ok'); }
    catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
  }
  async function changeBanner() {
    const file = await pickFile('image/*'); if (!file) return;
    try { const buf = await file.arrayBuffer();
      await api.post('/me/banner', buf, { raw: true, headers: { 'Content-Type': file.type || 'image/jpeg' } });
      const { user } = await api.get('/me'); store.state.me = user;
      clear(c); profileTab(c); toast('Banner aktualisiert.', 'ok'); }
    catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
  }
}

// ---- Datenschutz ----------------------------------------------------------
function privacyTab(c) {
  const me = store.state.me;
  c.append(
    setRow('eye', '„Zuletzt online" zeigen', { sub: 'Andere sehen, wann du zuletzt aktiv warst.',
      trailing: switchEl(me.showLastSeen, async (v) => {
        await api.post('/me/privacy', { showLastSeen: v }); store.state.me.showLastSeen = v; }) }),
    setRow('doublecheck', 'Lesebestätigungen', { sub: 'Auf diesem Gerät.',
      trailing: switchEl(prefs.get('readReceipts'), (v) => { prefs.set('readReceipts', v); }) }),
    selectRow('Nachrichtenspeicher', me.messageStorage || 'server',
      [['server', 'Auf dem Server'], ['local', 'Nur auf diesem Gerät']], async (v) => {
        const { user } = await api.post('/me/message-storage', { mode: v }); store.state.me = user; }),
    el('div', { class: 'list-section', text: 'Blockiert' }),
    setRow('block', 'Blockierte Kontakte', { sub: 'Verwalten, wen du blockiert hast.',
      onClick: blockedList }),
  );
}

async function blockedList() {
  const mdl = modal({ title: 'Blockierte Kontakte', body: (b) => b.append(el('div', { class: 'hint', text: 'Lade …' })) });
  try {
    const { blocked } = await api.get('/blocks');
    clear(mdl.body);
    if (!blocked?.length) { mdl.body.append(el('div', { class: 'pane-empty', text: 'Du hast niemanden blockiert.' })); return; }
    for (const id of blocked) {
      let user = { id, displayName: 'Kontakt' };
      try { ({ user } = await api.get(`/users/${id}`)); } catch { /* keep placeholder */ }
      const rowEl = el('div', { class: 'urow' }, [
        avatar(user, 44, { kind: 'user' }),
        el('div', { class: 'meta' }, el('div', { class: 'uname', text: user.displayName })),
        el('button', { class: 'btn sm', onClick: async (e) => {
          try { await api.post(`/users/${id}/unblock`); e.target.closest('.urow').remove();
            toast('Entsperrt.', 'ok'); } catch (err) { toast(err.message, 'err'); } } }, 'Entsperren'),
      ]);
      mdl.body.append(rowEl);
    }
  } catch (e) { clear(mdl.body); mdl.body.append(el('div', { class: 'formerr', text: e.message })); }
}

// ---- Design ---------------------------------------------------------------
function designTab(c) {
  c.append(
    setRow(prefs.get('theme') === 'light' ? 'sun' : 'moon', 'Dunkles Design',
      { trailing: switchEl(prefs.get('theme') === 'dark', (v) => { prefs.set('theme', v ? 'dark' : 'light'); refreshDesign(c); }) }),
    el('div', { class: 'list-section', text: 'Akzentfarbe' }),
    el('div', { class: 'swatches' }, prefs.ACCENTS.map((color) =>
      el('button', { class: `swatch ${prefs.get('accent') === color ? 'on' : ''}`, style: { background: color },
        onClick: () => { prefs.set('accent', color); refreshDesign(c); } }))),
    el('div', { class: 'list-section', text: 'Chat-Hintergrund' }),
    el('div', { class: 'swatches' }, prefs.WALLPAPERS.map((w) =>
      el('button', { class: `swatch ${prefs.get('wallpaper') === w.id ? 'on' : ''}`, title: w.label,
        style: { background: w.css || 'var(--surface-3)', backgroundSize: 'cover' },
        onClick: () => { prefs.set('wallpaper', w.id); refreshDesign(c); } }))),
    el('div', { class: 'list-section', text: 'Schriftgröße' }),
    rangeRow(prefs.get('fontScale'), 0.9, 1.3, 0.05, (v) => prefs.set('fontScale', v)),
    el('div', { class: 'list-section', text: 'Liste' }),
    setRow('chat', 'Kompakte Chat-Liste', { sub: 'Schmalere Zeilen.',
      trailing: switchEl(prefs.get('compact'), (v) => { prefs.set('compact', v); store.emit('prefs'); }) }),
    setRow('emoji', 'Große Emojis', { sub: 'Emoji-only Nachrichten größer anzeigen.',
      trailing: switchEl(prefs.get('largeEmoji'), (v) => prefs.set('largeEmoji', v)) }),
    el('div', { class: 'list-section', text: 'Barrierefreiheit' }),
    setRow('contrast', 'Hoher Kontrast', { trailing: switchEl(prefs.get('highContrast'),
      (v) => prefs.set('highContrast', v)) }),
    setRow('bolt', 'Reduzierte Bewegung', { trailing: switchEl(prefs.get('reduceMotion'),
      (v) => prefs.set('reduceMotion', v)) }),
    setRow('send', 'Mit Enter senden', { sub: 'Aus: Enter macht eine neue Zeile (Strg+Enter sendet).',
      trailing: switchEl(prefs.get('enterToSend'), (v) => prefs.set('enterToSend', v)) }),
  );
}
function refreshDesign(c) { clear(c); designTab(c); }

// ---- Mitteilungen ---------------------------------------------------------
function notifyTab(c) {
  const supported = 'Notification' in window;
  c.append(
    setRow('bell', 'Benachrichtigungen', {
      sub: supported ? 'Hinweise bei neuen Nachrichten.' : 'Dein Browser unterstützt das nicht.',
      trailing: switchEl(prefs.get('notifEnabled') && (!supported || Notification.permission === 'granted'),
        async (v) => {
          if (!v) { prefs.set('notifEnabled', false); return; }
          if (!supported) throw new Error('Nicht unterstützt.');
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') throw new Error('Erlaubnis verweigert.');
          prefs.set('notifEnabled', true);
        }) }),
    setRow('chat', 'Vorschau anzeigen', { sub: 'Nachrichtentext in der Benachrichtigung.',
      trailing: switchEl(prefs.get('notifPreview'), (v) => prefs.set('notifPreview', v)) }),
  );
}

// ---- Mehr -----------------------------------------------------------------
function moreTab(c, close) {
  c.append(
    setRow('download', 'Daten exportieren', { sub: 'Konto + Chatverläufe als JSON herunterladen.',
      onClick: exportData }),
    setRow('link', 'Dieses Gerät', { sub: 'Web-Sitzung · angemeldet als ' + (store.state.me?.displayName || '') }),
    el('div', { style: { marginTop: '18px' } },
      el('button', { class: 'btn danger block', onClick: () => { close(); doLogout(false); } },
        [icon('logout'), 'Abmelden'])),
  );
}

async function exportData() {
  toast('Exportiere …');
  try {
    const data = await api.get('/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = el('a', { href: u, download: 'ping-export.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    toast('Export geladen.', 'ok');
  } catch (e) { toast(e.message || 'Export fehlgeschlagen', 'err'); }
}

// ---- shared row builders --------------------------------------------------
function editRow(label, value, onSave, placeholder) {
  const input = el('input', { class: 'input', value, placeholder: placeholder || '' });
  const btn = el('button', { class: 'btn sm primary', onClick: () => onSave(input.value.trim()) }, 'OK');
  btn.style.display = 'none';
  input.addEventListener('input', () => { btn.style.display = input.value !== value ? '' : 'none'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(input.value.trim()); });
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [el('div', { style: { flex: '1' } }, input), btn]),
  ]);
}

function selectRow(label, value, options, onChange) {
  const sel = el('select', { class: 'input', style: { cursor: 'pointer' } },
    options.map(([v, t]) => el('option', { value: v, selected: v === value ? 'selected' : null }, t)));
  sel.addEventListener('change', async () => {
    try { await onChange(sel.value); toast('Gespeichert.', 'ok'); } catch (e) { toast(e.message, 'err'); } });
  return el('div', { class: 'field' }, [el('label', { text: label }), sel]);
}

function rangeRow(value, min, max, step, onChange) {
  const out = el('span', { class: 'v', text: `${Math.round(value * 100)} %` });
  const input = el('input', { type: 'range', min, max, step, value, style: { width: '100%' } });
  input.addEventListener('input', () => { out.textContent = `${Math.round(input.value * 100)} %`;
    onChange(parseFloat(input.value)); });
  return el('div', { class: 'field' }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between' } },
      [el('label', { text: 'Größe' }), out]),
    input,
  ]);
}

function changePassword() {
  const err = el('div', { class: 'formerr' });
  const cur = el('input', { class: 'input', type: 'password', placeholder: 'Aktuelles Passwort' });
  const next = el('input', { class: 'input', type: 'password', placeholder: 'Neues Passwort (min. 8)' });
  const m = modal({
    title: 'Passwort ändern',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Aktuelles Passwort' }), cur]),
      el('div', { class: 'field' }, [el('label', { text: 'Neues Passwort' }), next]), err),
    foot: [el('button', { class: 'btn primary', onClick: submit }, 'Speichern')],
  });
  async function submit() {
    err.textContent = '';
    if (next.value.length < 8) { err.textContent = 'Mind. 8 Zeichen.'; return; }
    try { await api.patch('/me/security', { password: next.value, currentPassword: cur.value });
      m.close(); toast('Passwort geändert.', 'ok'); }
    catch (e) { err.textContent = e.message; }
  }
}
