/* settings.js — the user's own profile + account settings: avatar, name/about,
   email/password, privacy (last-seen, message storage), theme and logout. */

import { api } from './api.js';
import * as store from './store.js';
import { el, icon, avatar, modal, toast } from './ui.js';
import { pickFile } from './media.js';
import { doLogout, toggleTheme } from './app.js';

export function openSettings() {
  const m = modal({ title: 'Einstellungen', width: '480px', body: (body) => render(body) });

  function render(body) {
    body.replaceChildren();
    const me = store.state.me;

    // profile header with avatar
    const avBox = el('div', { style: { position: 'relative', cursor: 'pointer' },
      onClick: changeAvatar, title: 'Profilbild ändern' },
      avatar(me, 96, { kind: 'user' }));
    avBox.appendChild(el('div', { style: { position: 'absolute', right: '0', bottom: '0',
      background: 'var(--accent)', borderRadius: '50%', width: '30px', height: '30px',
      display: 'flex', alignItems: 'center', justifyContent: 'center' } }, icon('camera', 'sm')));

    body.append(
      el('div', { class: 'profile-pane' }, [avBox, el('h3', { text: me.displayName,
        style: { margin: '4px 0 0' } }), el('div', { class: 'hint', text: me.phone })]),
      sectionLabel('Profil'),
      editRow('Name', me.displayName, (v) => save({ displayName: v })),
      editRow('Info', me.about || '', (v) => save({ about: v }), 'Hey, ich nutze Ping!'),
      editRow('Ort', me.city || '', (v) => save({ city: v })),
      sectionLabel('Konto'),
      el('div', { class: 'profile-row' }, [el('span', { class: 'k', text: 'E-Mail' }),
        el('span', { class: 'v', text: me.email })]),
      actionRow('Passwort ändern', 'lock', changePassword),
      sectionLabel('Privatsphäre'),
      toggleRow('„Zuletzt online" zeigen', me.showLastSeen, async (v) => {
        await api.post('/me/privacy', { showLastSeen: v });
        store.state.me.showLastSeen = v;
      }),
      selectRow('Nachrichtenspeicher', me.messageStorage || 'server',
        [['server', 'Auf dem Server'], ['local', 'Nur auf diesem Gerät']], async (v) => {
        const { user } = await api.post('/me/message-storage', { mode: v });
        store.state.me = user;
      }),
      sectionLabel('Darstellung'),
      actionRow(document.documentElement.getAttribute('data-theme') === 'light'
        ? 'Dunkles Design' : 'Helles Design',
        document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun',
        () => { toggleTheme(); render(body); }),
      el('div', { style: { marginTop: '20px' } },
        el('button', { class: 'btn danger block', onClick: () => { m.close(); doLogout(false); } },
          [icon('logout'), 'Abmelden'])),
    );

    async function save(patch) {
      try { const { user } = await api.patch('/me', patch); store.state.me = user;
        store.emit('me-updated'); render(body); toast('Gespeichert.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    }
    async function changeAvatar() {
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        await api.post('/me/avatar', buf, { raw: true,
          headers: { 'Content-Type': file.type || 'image/jpeg' } });
        const { user } = await api.get('/me');
        store.state.me = user; store.emit('me-updated'); render(body);
        toast('Profilbild aktualisiert.', 'ok');
      } catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
    }
  }
}

function sectionLabel(t) { return el('div', { class: 'list-section', text: t,
  style: { padding: '16px 0 2px' } }); }

function editRow(label, value, onSave, placeholder) {
  const input = el('input', { class: 'input', value, placeholder: placeholder || '' });
  const btn = el('button', { class: 'btn sm primary', onClick: () => onSave(input.value.trim()) }, 'OK');
  btn.style.display = 'none';
  input.addEventListener('input', () => { btn.style.display = input.value !== value ? '' : 'none'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(input.value.trim()); });
  return el('div', { class: 'field', style: { marginBottom: '8px' } }, [
    el('label', { text: label }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [el('div', { style: { flex: '1' } }, input), btn]),
  ]);
}

function actionRow(label, ic, onClick) {
  return el('button', { class: 'urow', style: { width: '100%' }, onClick }, [
    el('div', { class: 'av', style: { width: '40px', height: '40px', background: 'var(--surface-3)',
      color: 'var(--muted)' } }, icon(ic, 'sm')),
    el('div', { class: 'meta' }, el('div', { class: 'uname', text: label })),
  ]);
}

function toggleRow(label, on, onChange) {
  const sw = el('div', { style: { width: '44px', height: '26px', borderRadius: '13px',
    background: on ? 'var(--accent)' : 'var(--surface-3)', position: 'relative', cursor: 'pointer',
    transition: 'background .15s', flex: '0 0 auto' } });
  const knob = el('div', { style: { position: 'absolute', top: '3px', left: on ? '21px' : '3px',
    width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left .15s' } });
  sw.appendChild(knob);
  let cur = on;
  sw.addEventListener('click', async () => {
    cur = !cur;
    sw.style.background = cur ? 'var(--accent)' : 'var(--surface-3)';
    knob.style.left = cur ? '21px' : '3px';
    try { await onChange(cur); } catch (e) { toast(e.message, 'err'); }
  });
  return el('div', { class: 'profile-row', style: { flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between' } }, [el('span', { class: 'v', text: label }), sw]);
}

function selectRow(label, value, options, onChange) {
  const sel = el('select', { class: 'input', style: { cursor: 'pointer' } },
    options.map(([v, t]) => el('option', { value: v, selected: v === value ? 'selected' : null }, t)));
  sel.addEventListener('change', async () => {
    try { await onChange(sel.value); toast('Gespeichert.', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
  return el('div', { class: 'field', style: { marginBottom: '8px' } },
    [el('label', { text: label }), sel]);
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
    try {
      await api.patch('/me/security', { password: next.value, currentPassword: cur.value });
      m.close(); toast('Passwort geändert.', 'ok');
    } catch (e) { err.textContent = e.message; }
  }
}
