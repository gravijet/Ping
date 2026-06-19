/* settings.js — the user's account + app settings, organised into tabs:
   Profil · Chats · Datenschutz · Design · Mitteilungen · Mehr. Server-backed
   settings (profile, privacy, password, message storage, blocking, export) go
   through /api; device-side preferences (theme, accent, wallpaper, chat
   behaviour, accessibility) live in prefs.js and re-theme/re-behave the whole
   client instantly. */

import { api, authedObjectUrl, clearBlobCache } from './api.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, modal, toast, switchEl, setRow, confirmModal } from './ui.js';
import { pickFile } from './media.js';
import { doLogout, refreshThemeNav } from './app.js';
import { isShell, setAutostart, setCloseToTray } from './native.js';
import { flag } from './flags.js';
import { openThemeStudio } from './themes.js';
import { renderInsights } from './insights.js';
import { openShortcuts } from './shortcuts.js';

// One calm settings surface: a category list on the left, the chosen section on
// the right — no nested tab-hunting, no sub-modals for routine rows.
const CATS = [
  ['Profil', 'user'],
  ['Chats', 'chat'],
  ['Datenschutz', 'shield'],
  ['Design', 'palette'],
  ['Mitteilungen', 'bell'],
  ['Geräte', 'link'],
  ['Mehr', 'info'],
];
const WEB_CLIENT_VERSION = '0.22.0';

// A no-op placeholder for `node.append(...)` (native append would turn a bare
// null into the literal text "null") when a row is feature-flagged off.
const noNode = () => document.createTextNode('');

export function openSettings(startCat = 'Profil') {
  let cat = startCat;
  // `modal()` runs the body callback synchronously, before the handle is
  // assigned — so close lazily through a holder rather than capturing it now.
  const ctx = {};
  const closeModal = () => ctx.modal && ctx.modal.close();
  ctx.modal = modal({ title: 'Einstellungen', width: '720px', body: (body) => {
    const cats = el('div', { class: 'settings-cats' }, CATS.map(([t, ic]) =>
      el('button', { class: `settings-cat ${t === cat ? 'on' : ''}`, dataset: { cat: t },
        onClick: () => { cat = t; render(); } }, [icon(ic), el('span', { text: t })])));
    const content = el('div', { class: 'settings-content' });
    body.append(el('div', { class: 'settings-layout' }, [cats, content]));

    function render() {
      cats.querySelectorAll('.settings-cat').forEach((b) => b.classList.toggle('on', b.dataset.cat === cat));
      clear(content);
      if (cat === 'Profil') profileTab(content);
      else if (cat === 'Chats') chatsTab(content);
      else if (cat === 'Datenschutz') privacyTab(content);
      else if (cat === 'Design') designTab(content);
      else if (cat === 'Mitteilungen') notifyTab(content);
      else if (cat === 'Geräte') devicesTab(content);
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
    moodRow(me, save),
    editRow('Ort', me.city || '', (v) => save({ city: v })),
    editRow('Pronomen', me.pronouns || '', (v) => save({ pronouns: v }), 'z. B. sie/ihr'),
    dateRow('Geburtstag', me.birthday || '', (v) => save({ birthday: v })),
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

// Mood = a short status with an emoji, mirroring the native app's "Stimmung".
function moodRow(me, save) {
  const emoji = el('input', { class: 'input', value: me.moodEmoji || '', maxlength: '4',
    placeholder: '🙂', style: { width: '64px', textAlign: 'center', flex: '0 0 auto' } });
  const text = el('input', { class: 'input', value: me.moodText || '', placeholder: 'Stimmung / Status …' });
  const btn = el('button', { class: 'btn sm primary', onClick: () =>
    save({ moodEmoji: emoji.value.trim(), moodText: text.value.trim() }) }, 'OK');
  btn.style.display = 'none';
  const dirty = () => { btn.style.display =
    (emoji.value !== (me.moodEmoji || '') || text.value !== (me.moodText || '')) ? '' : 'none'; };
  emoji.addEventListener('input', dirty); text.addEventListener('input', dirty);
  return el('div', { class: 'field' }, [
    el('label', { text: 'Stimmung' }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [emoji, el('div', { style: { flex: '1' } }, text), btn]),
  ]);
}

// ---- Chats ----------------------------------------------------------------
function chatsTab(c) {
  c.append(
    el('div', { class: 'list-section', text: 'Schreiben' }),
    setRow('send', 'Mit Enter senden', {
      sub: 'Aus: Enter macht eine neue Zeile (Strg+Enter sendet).',
      trailing: switchEl(prefs.get('enterToSend'), (v) => prefs.set('enterToSend', v)) }),
    setRow('type', 'Rechtschreibprüfung', { sub: 'Tippfehler im Eingabefeld unterstreichen.',
      trailing: switchEl(prefs.get('spellcheck'), (v) => prefs.set('spellcheck', v)) }),
    setRow('edit', 'Text-Formatierung', {
      sub: 'Mit *fett*, _kursiv_, ~durchgestrichen~, `Code` und ||Spoiler|| gestalten.',
      trailing: switchEl(prefs.get('messageFormatting'), (v) => prefs.set('messageFormatting', v)) }),
    setRow('bolt', 'Schnellantworten', {
      sub: `${(prefs.get('quickReplies') || []).length} vorbereitete Antworten · im Chat über ⚡ einfügen`,
      onClick: () => quickRepliesEditor(() => { clear(c); chatsTab(c); }) }),
    el('div', { class: 'list-section', text: 'Darstellung' }),
    setRow('chat', 'Kompakte Chat-Liste', { sub: 'Schmalere Zeilen in der Seitenleiste.',
      trailing: switchEl(prefs.get('compact'), (v) => { prefs.set('compact', v); store.emit('prefs'); }) }),
    setRow('emoji', 'Große Emojis', { sub: 'Emoji-only Nachrichten größer anzeigen.',
      trailing: switchEl(prefs.get('largeEmoji'), (v) => prefs.set('largeEmoji', v)) }),
    selectRowLocal('Sprechblasen', prefs.get('bubbleStyle'),
      [['rounded', 'Abgerundet'], ['square', 'Kantig']], (v) => prefs.set('bubbleStyle', v)),
    el('div', { class: 'list-section', text: 'Speicher' }),
    setRow('refresh', 'Zwischenspeicher leeren', {
      sub: 'Geladene Bilder & Medien aus diesem Browser entfernen.',
      onClick: async () => {
        if (!await confirmModal({ title: 'Zwischenspeicher leeren',
          message: 'Heruntergeladene Medien werden bei Bedarf neu geladen.', confirmText: 'Leeren' })) return;
        clearBlobCache(); toast('Zwischenspeicher geleert.', 'ok');
      } }),
  );
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
    setRow('edit', 'Schreibstatus senden', { sub: 'Anderen „tippt …" anzeigen, während du schreibst.',
      trailing: switchEl(prefs.get('sendTyping'), (v) => prefs.set('sendTyping', v)) }),
    selectRow('Nachrichtenspeicher', me.messageStorage || 'server',
      [['server', 'Auf dem Server'], ['local', 'Nur auf diesem Gerät']], async (v) => {
        const { user } = await api.post('/me/message-storage', { mode: v }); store.state.me = user; }),
    el('div', { class: 'list-section', text: 'App-Sperre' }),
    setRow('shield', 'Mit PIN sperren', {
      sub: prefs.get('lockEnabled') ? 'Aktiv · sperrt sich nach Inaktivität' : 'Ping auf diesem Gerät mit einer PIN schützen.',
      onClick: () => import('./lock.js').then((m) => m.lockSettings()) }),
    el('div', { class: 'list-section', text: 'Blockiert' }),
    setRow('block', 'Blockierte Kontakte', { sub: 'Verwalten, wen du blockiert hast.',
      onClick: blockedList }),
    el('div', { class: 'list-section', text: 'Diagnose' }),
    setRow('shield', 'Diagnose & Absturzberichte', {
      sub: 'Optional. Anonym, ohne Nachrichteninhalte – hilft, Fehler zu finden. Standardmäßig aus.',
      trailing: switchEl(prefs.get('diagnostics') === true, (v) => prefs.set('diagnostics', v)) }),
    setRow('bolt', 'Debug & Diagnose', { sub: 'Verbindung, Logs, Feature-Flags (Strg + ⇧ + D).',
      onClick: () => import('./debug.js').then((m) => m.openDebugPanel()) }),
  );
}

// ---- Geräte ---------------------------------------------------------------
function devicesTab(c) {
  const me = store.state.me;
  c.append(
    el('div', { class: 'list-section', text: 'Angemeldet' }),
    setRow('eye', 'Dieses Gerät', { sub: 'Web-Sitzung · ' + (me?.displayName || '') }),
    el('div', { class: 'list-section', text: 'Weiteres Gerät' }),
    setRow('link', 'Gerät verknüpfen', { sub: 'Ein anderes Gerät mit deinem Konto anmelden.',
      onClick: () => import('./devices.js').then((m) => m.linkDeviceModal()) }),
    el('p', { class: 'hint', style: { lineHeight: '1.6', marginTop: '10px' },
      text: 'Öffne Ping auf dem neuen Gerät, wähle „Mit dem Handy verknüpfen“ und ' +
        'gib den dort angezeigten Code hier ein.' }),
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

// Manage the canned composer replies (mirrors the native app's Schnellantworten).
function quickRepliesEditor(onChange) {
  const list = el('div');
  const input = el('input', { class: 'input', placeholder: 'Neue Schnellantwort …' });
  const current = () => [...(prefs.get('quickReplies') || [])];
  const save = (arr) => { prefs.set('quickReplies', arr); paint(); onChange && onChange(); };
  const m = modal({
    title: 'Schnellantworten',
    body: (b) => b.append(
      el('p', { class: 'hint', text: 'Kurze Standardantworten, die du im Chat über das ⚡-Symbol mit einem Tipp einfügst.' }),
      list,
      el('div', { class: 'field', style: { marginTop: '10px' } }, [
        el('label', { text: 'Hinzufügen' }),
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('div', { style: { flex: '1' } }, input),
          el('button', { class: 'btn primary sm', onClick: add }, 'OK'),
        ]),
      ]),
    ),
    foot: [el('button', { class: 'btn ghost', onClick: reset }, 'Zurücksetzen')],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  paint();
  function paint() {
    clear(list);
    const arr = current();
    if (!arr.length) { list.append(el('div', { class: 'hint', text: 'Noch keine Schnellantworten.' })); return; }
    arr.forEach((text, i) => list.append(el('div', { class: 'set-row' }, [
      el('div', { class: 'set-main' }, el('div', { class: 'set-title', text })),
      el('button', { class: 'iconbtn', title: 'Entfernen', onClick: () => {
        const next = current(); next.splice(i, 1); save(next); } }, icon('trash')),
    ])));
  }
  function add() {
    const t = input.value.trim(); if (!t) return;
    const arr = current(); if (!arr.includes(t)) arr.push(t);
    input.value = ''; save(arr); input.focus();
  }
  function reset() {
    save(['👍 Alles klar!', 'Bin gleich da 🏃', 'Melde mich später 🙂', 'Danke dir! 🙏', 'Kannst du kurz anrufen?']);
  }
  return m;
}

// ---- Design ---------------------------------------------------------------
function designTab(c) {
  if (flag('themeStudio')) c.append(setRow('paint', 'Theme Studio', {
    sub: 'Vorlagen, eigene Akzentfarbe & teilbare Theme-Codes.', onClick: openThemeStudio }));
  c.append(
    selectRowLocal('Erscheinungsbild', prefs.get('theme'),
      [['system', 'Automatisch (System)'], ['light', 'Hell'], ['dark', 'Dunkel']],
      (v) => { prefs.set('theme', v); refreshThemeNav(); refreshDesign(c); }),
    flag('amoledTheme') ? setRow('moon', 'AMOLED-Schwarz', {
      sub: 'Reines Schwarz im dunklen Design – schont OLED-Displays.',
      trailing: switchEl(prefs.get('amoled'), (v) => { prefs.set('amoled', v); refreshDesign(c); }) }) : noNode(),
    el('div', { class: 'list-section', text: 'Akzentfarbe' }),
    el('div', { class: 'swatches' }, [
      ...prefs.ACCENTS.map((color) =>
        el('button', { class: `swatch ${prefs.get('accent') === color ? 'on' : ''}`, style: { background: color },
          onClick: () => { prefs.set('accent', color); refreshDesign(c); } })),
      customColorSwatch(),
    ]),
    el('div', { class: 'list-section', text: 'Chat-Hintergrund' }),
    el('div', { class: 'swatches' }, [
      ...prefs.WALLPAPERS.map((w) =>
        el('button', { class: `swatch ${prefs.get('wallpaper') === w.id ? 'on' : ''}`, title: w.label,
          style: { background: w.css || 'var(--surface-3)', backgroundSize: 'cover' },
          onClick: () => { prefs.set('wallpaper', w.id); refreshDesign(c); } })),
      el('button', { class: `swatch ${(prefs.get('wallpaper') || '').startsWith('data:') ? 'on' : ''}`,
        title: 'Eigenes Bild', style: { display: 'grid', placeItems: 'center' },
        onClick: uploadWallpaper }, icon('image', 'sm')),
    ]),
    el('div', { class: 'list-section', text: 'Schrift' }),
    rangeRow(prefs.get('fontScale'), 0.9, 1.3, 0.05, (v) => prefs.set('fontScale', v)),
    selectRowLocal('Schriftart', prefs.get('fontFamily') || 'jakarta',
      prefs.FONTS.map((f) => [f[0], f[1]]), (v) => prefs.set('fontFamily', v)),
    el('div', { class: 'list-section', text: 'Barrierefreiheit' }),
    setRow('contrast', 'Hoher Kontrast', { trailing: switchEl(prefs.get('highContrast'),
      (v) => prefs.set('highContrast', v)) }),
    setRow('bolt', 'Reduzierte Bewegung', { sub: 'Animationen minimieren.',
      trailing: switchEl(prefs.get('reduceMotion'), (v) => prefs.set('reduceMotion', v)) }),
    setRow('link', 'Links unterstreichen', { sub: 'Verweise immer unterstrichen darstellen.',
      trailing: switchEl(prefs.get('underlineLinks'), (v) => prefs.set('underlineLinks', v)) }),
    setRow('plus', 'Größere Schaltflächen', { sub: 'Mehr Abstand und größere Klickflächen.',
      trailing: switchEl(prefs.get('bigTargets'), (v) => prefs.set('bigTargets', v)) }),
  );

  function customColorSwatch() {
    const isPreset = prefs.ACCENTS.includes(prefs.get('accent'));
    const input = el('input', { type: 'color', value: prefs.get('accent') || '#4d9bff',
      style: { position: 'absolute', inset: '0', opacity: '0', cursor: 'pointer' } });
    input.addEventListener('input', () => { prefs.set('accent', input.value); });
    input.addEventListener('change', () => refreshDesign(c));
    return el('button', { class: `swatch ${!isPreset ? 'on' : ''}`,
      title: 'Eigene Farbe', style: { position: 'relative',
        background: 'conic-gradient(red, orange, yellow, lime, aqua, blue, magenta, red)' } }, input);
  }

  async function uploadWallpaper() {
    const file = await pickFile('image/*'); if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Bild ist zu groß (max. 2 MB).', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => { prefs.set('wallpaper', reader.result); refreshDesign(c); };
    reader.readAsDataURL(file);
  }
}
function refreshDesign(c) { clear(c); designTab(c); }

// ---- Mitteilungen ---------------------------------------------------------
function notifyTab(c) {
  const shell = isShell();
  const supported = shell || 'Notification' in window;
  c.append(
    setRow('bell', 'Benachrichtigungen', {
      sub: supported ? 'Hinweise bei neuen Nachrichten.' : 'Dein Browser unterstützt das nicht.',
      trailing: switchEl(prefs.get('notifEnabled') && (shell || (supported && Notification.permission === 'granted')),
        async (v) => {
          if (!v) { prefs.set('notifEnabled', false); return; }
          if (shell) { prefs.set('notifEnabled', true); return; } // host handles OS toasts
          if (!supported) throw new Error('Nicht unterstützt.');
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') throw new Error('Erlaubnis verweigert.');
          prefs.set('notifEnabled', true);
        }) }),
    setRow('chat', 'Vorschau anzeigen', { sub: 'Nachrichtentext in der Benachrichtigung.',
      trailing: switchEl(prefs.get('notifPreview'), (v) => prefs.set('notifPreview', v)) }),
    setRow('bell', 'Ton abspielen', { sub: 'Sanfter Hinweiston bei neuen Nachrichten.',
      trailing: switchEl(prefs.get('notifSound'), (v) => prefs.set('notifSound', v)) }),
    el('div', { class: 'list-section', text: 'Anrufe' }),
    setRow('phone', 'Anrufton', { sub: 'Klingeln bei eingehenden und ausgehenden Anrufen.',
      trailing: switchEl(prefs.get('callRingtone'), (v) => prefs.set('callRingtone', v)) }),
    el('div', { class: 'list-section', text: 'Nicht stören' }),
    dndRow(c),
  );
}

// Do Not Disturb: silence all notifications until a chosen time.
function dndRow(c) {
  const active = (prefs.get('dndUntil') || 0) > Date.now();
  const opts = [['0', 'Aus'], ['30', '30 Minuten'], ['60', '1 Stunde'], ['240', '4 Stunden'], ['1440', 'Bis morgen']];
  const sel = el('select', { class: 'input', style: { cursor: 'pointer' } },
    opts.map(([v, t]) => el('option', { value: v }, t)));
  sel.addEventListener('change', () => {
    const mins = Number(sel.value);
    prefs.set('dndUntil', mins ? Date.now() + mins * 60000 : 0);
    clear(c); notifyTab(c);
    toast(mins ? 'Nicht stören aktiviert.' : 'Nicht stören aus.', 'ok');
  });
  return el('div', { class: 'field' }, [
    el('label', { text: active
      ? 'Aktiv bis ' + new Date(prefs.get('dndUntil')).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : 'Benachrichtigungen vorübergehend stummschalten' }),
    sel,
  ]);
}

// ---- Mehr -----------------------------------------------------------------
function moreTab(c, close) {
  c.append(
    setRow('download', 'Backup / Daten exportieren', { sub: 'Konto + Chatverläufe als JSON herunterladen.',
      onClick: exportData }),
    el('div', { class: 'list-section', text: 'Einstellungen' }),
    setRow('palette', 'Einstellungen sichern', { sub: 'Design & Verhalten dieses Geräts als Datei speichern.',
      onClick: backupPrefs }),
    setRow('refresh', 'Einstellungen wiederherstellen', { sub: 'Aus einer zuvor gespeicherten Sicherungsdatei laden.',
      onClick: () => restorePrefs(close) }),
    el('div', { class: 'list-section', text: 'Teilen' }),
    setRow('forward', 'Ping teilen / einladen', { sub: 'Lade jemanden zu Ping ein.',
      onClick: () => import('./share.js').then((m) => m.shareInvite()) }),
    el('div', { class: 'list-section', text: 'Hilfe' }),
    flag('insights') ? setRow('status', 'Nutzungs-Insights', {
      sub: 'Deine Aktivität – nur lokal, wird nie gesendet.', onClick: insightsModal }) : noNode(),
    setRow('bolt', 'Tastenkürzel', { sub: 'Schneller navigieren mit der Tastatur. (Taste ?)',
      onClick: openShortcuts }),
    setRow('info', 'Über Ping', { sub: `Ping Web ${WEB_CLIENT_VERSION}`, onClick: aboutModal }),
    ...(isShell() ? desktopRows() : []),
    el('div', { style: { marginTop: '18px' } },
      el('button', { class: 'btn danger block', onClick: () => { close(); doLogout(false); } },
        [icon('logout'), 'Abmelden'])),
  );
}

// Windows-shell-only rows (autostart, close-to-tray) shown in the "Mehr" tab.
function desktopRows() {
  return [
    el('div', { class: 'list-section', text: 'Windows-App' }),
    setRow('bolt', 'Mit Windows starten', { sub: 'Ping automatisch beim Anmelden öffnen.',
      trailing: switchEl(prefs.get('desktopAutostart'), (v) => { prefs.set('desktopAutostart', v); setAutostart(v); }) }),
    setRow('archive', 'In den Infobereich schließen', { sub: 'Schließen versteckt Ping im Tray, statt es zu beenden.',
      trailing: switchEl(prefs.get('desktopCloseToTray'), (v) => { prefs.set('desktopCloseToTray', v); setCloseToTray(v); }) }),
  ];
}

// Local-only usage insights (messages sent, 7-day sparkline, busiest chat).
function insightsModal() {
  modal({ title: 'Nutzungs-Insights', width: '460px', body: (b) => renderInsights(b) });
}

function aboutModal() {
  modal({ title: 'Über Ping', body: (b) => b.append(
    el('div', { class: 'profile-pane', style: { paddingTop: '6px' } }, [
      el('div', { class: 'splash-glyph-sm', text: 'P' }),
      el('h3', { text: 'Ping Web' }),
      el('div', { class: 'hint', text: `Version ${WEB_CLIENT_VERSION}` }),
    ]),
    el('p', { class: 'hint', style: { lineHeight: '1.6', textAlign: 'center' },
      text: 'Der dedizierte PC-Client für Ping. Läuft im Browser und in der ' +
        'Windows-App. Verschlüsselt über HTTPS · kein Tracking.' }),
  ) });
}

// Download all device-side preferences as a small JSON file.
function backupPrefs() {
  try {
    const blob = new Blob([JSON.stringify(prefs.exportPrefs(), null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = el('a', { href: u, download: `ping-einstellungen-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    toast('Einstellungen gesichert.', 'ok');
  } catch (e) { toast(e.message || 'Sicherung fehlgeschlagen', 'err'); }
}

// Restore preferences from a backup file, then re-theme the whole client.
async function restorePrefs(close) {
  const file = await pickFile('application/json,.json'); if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    prefs.importPrefs(data);
    store.emit('prefs');
    refreshThemeNav();
    toast('Einstellungen wiederhergestellt.', 'ok');
    if (close) close();
  } catch (e) { toast(e.message || 'Datei konnte nicht gelesen werden.', 'err'); }
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

function dateRow(label, value, onSave) {
  const input = el('input', { class: 'input', type: 'date', value: value || '' });
  const btn = el('button', { class: 'btn sm primary', onClick: () => onSave(input.value) }, 'OK');
  btn.style.display = 'none';
  input.addEventListener('input', () => { btn.style.display = input.value !== value ? '' : 'none'; });
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

// Like selectRow but for a local pref (no async / no toast).
function selectRowLocal(label, value, options, onChange) {
  const sel = el('select', { class: 'input', style: { cursor: 'pointer' } },
    options.map(([v, t]) => el('option', { value: v, selected: v === value ? 'selected' : null }, t)));
  sel.addEventListener('change', () => onChange(sel.value));
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
