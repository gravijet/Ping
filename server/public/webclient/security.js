/* security.js — the "Sicherheit" settings surface (0.32.0 "Identität & Schutz").
   Four sections, all server-backed:
     • Benutzername    — claim / change / remove a public @username,
     • Zwei-Faktor     — TOTP setup wizard (QR + recovery codes), disable, rotate,
     • Sitzungen       — "überall abmelden" (bumps the session epoch),
     • Protokoll       — the per-account security audit feed.
   Loaded lazily from settings.js so its QR dependency + markup never weigh on
   first paint. */

import { api, setToken } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, setRow, confirmModal } from './ui.js';
import { flag } from './flags.js';
import { QR } from './vendor/qrcode.min.js';

// Render the whole tab into [c]. [rerender] re-runs this tab after a change.
export function renderSecurityTab(c, rerender) {
  const me = store.state.me || {};
  const reload = () => rerender();

  if (flag('usernames')) {
    c.append(el('div', { class: 'list-section', text: 'Benutzername' }));
    if (me.username) {
      c.append(setRow('hash', `@${me.username}`, {
        sub: 'Dein öffentlicher Benutzername · über @Name auffindbar.',
        onClick: () => usernameModal(reload),
      }));
    } else {
      c.append(setRow('hash', 'Benutzername wählen', {
        sub: 'Lass dich per @Name finden, ganz ohne Telefonnummer.',
        onClick: () => usernameModal(reload),
      }));
    }
  }

  if (flag('twoFactor')) {
    c.append(el('div', { class: 'list-section', text: 'Zwei-Faktor-Authentifizierung' }));
    const twofaHost = el('div');
    c.append(twofaHost);
    twofaHost.append(el('div', { class: 'sec-loading hint', text: 'Lade …' }));
    api.get('/me/2fa').then((s) => paintTwoFactor(twofaHost, s, reload))
      .catch(() => { clear(twofaHost); twofaHost.append(
        el('div', { class: 'hint', text: 'Status nicht verfügbar.' })); });
  }

  // ---- Sessions -----------------------------------------------------------
  c.append(el('div', { class: 'list-section', text: 'Sitzungen' }));
  c.append(setRow('logout', 'Überall abmelden', {
    sub: 'Beendet alle anderen Sitzungen. Dieses Gerät bleibt angemeldet.',
    onClick: async () => {
      if (!await confirmModal({
        title: 'Überall abmelden',
        message: 'Alle anderen Geräte werden abgemeldet und müssen sich neu anmelden. Fortfahren?',
        confirmText: 'Abmelden', danger: true,
      })) return;
      try {
        const r = await api.post('/me/logout-all');
        if (r.token) setToken(r.token);
        if (r.user) { store.state.me = r.user; store.emit('me-updated'); }
        toast('Alle anderen Sitzungen wurden beendet.', 'ok');
        reload();
      } catch (e) { toast(e.message || 'Fehlgeschlagen', 'err'); }
    },
  }));

  // ---- Security log -------------------------------------------------------
  c.append(el('div', { class: 'list-section', text: 'Sicherheitsprotokoll' }));
  const logHost = el('div', { class: 'sec-log' });
  c.append(logHost);
  logHost.append(el('div', { class: 'sec-loading hint', text: 'Lade …' }));
  api.get('/me/security-log').then(({ events }) => paintLog(logHost, events))
    .catch(() => { clear(logHost); logHost.append(
      el('div', { class: 'hint', text: 'Protokoll nicht verfügbar.' })); });
}

// ---- Username --------------------------------------------------------------
function usernameModal(reload) {
  const me = store.state.me || {};
  const err = el('div', { class: 'formerr' });
  const status = el('div', { class: 'sec-uname-status' });
  const input = el('input', {
    class: 'input', value: me.username || '', placeholder: 'deinname', maxlength: '24',
    autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
  });
  const save = el('button', { class: 'btn primary' }, me.username ? 'Ändern' : 'Übernehmen');
  let lastChecked = null;
  let available = false;

  let t = null;
  const check = () => {
    const v = input.value.trim().replace(/^@+/, '').toLowerCase();
    input.value = v;
    clear(status);
    available = false;
    if (!v) { save.disabled = true; return; }
    if (v === (me.username || '')) {
      status.append(el('span', { class: 'ok', text: 'Das ist dein aktueller Name.' }));
      save.disabled = true; return;
    }
    status.append(el('span', { class: 'hint', text: 'Prüfe …' }));
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const r = await api.get(`/me/username/check?u=${encodeURIComponent(v)}`);
        lastChecked = v; available = !!r.available;
        clear(status);
        status.append(r.available
          ? el('span', { class: 'ok' }, [icon('check', 'sm'), ` @${v} ist frei`])
          : el('span', { class: 'bad', text: r.reason || 'Nicht verfügbar.' }));
        save.disabled = !r.available;
      } catch { clear(status); }
    }, 320);
  };
  input.addEventListener('input', check);

  const submit = async () => {
    const v = input.value.trim().replace(/^@+/, '').toLowerCase();
    if (!v || !available) return;
    err.textContent = ''; save.disabled = true;
    try {
      const { user } = await api.put('/me/username', { username: v });
      store.state.me = user; store.emit('me-updated');
      toast(`Benutzername gesetzt: @${user.username}`, 'ok');
      m.close(); reload();
    } catch (e) { err.textContent = e.message; save.disabled = false; }
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  save.disabled = true;

  const foot = [save];
  if (me.username) {
    foot.unshift(el('button', { class: 'btn ghost danger', onClick: async () => {
      if (!await confirmModal({ title: 'Benutzername entfernen',
        message: 'Dein @Name wird freigegeben und du bist nicht mehr darüber auffindbar.',
        confirmText: 'Entfernen', danger: true })) return;
      try {
        const { user } = await api.del('/me/username');
        store.state.me = user; store.emit('me-updated');
        toast('Benutzername entfernt.', 'ok'); m.close(); reload();
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Entfernen'));
  }

  const m = modal({
    title: 'Benutzername',
    width: '440px',
    body: (b) => b.append(
      el('p', { class: 'hint', style: { marginTop: '0' },
        text: 'Andere können dich über @' + (me.username || 'deinname') + ' finden und ' +
          'anschreiben – ohne deine Telefonnummer zu kennen.' }),
      el('div', { class: 'sec-uname-row' }, [el('span', { class: 'at', text: '@' }), input]),
      status, err,
    ),
    foot,
  });
  setTimeout(() => input.focus(), 50);
  check();
}

// ---- Two-factor ------------------------------------------------------------
function paintTwoFactor(host, status, reload) {
  clear(host);
  if (status.enabled) {
    host.append(
      el('div', { class: 'sec-2fa-on' }, [
        icon('shield'),
        el('div', {}, [
          el('strong', { text: 'Aktiv' }),
          el('div', { class: 'hint', text:
            `${status.recoveryCodesLeft} Wiederherstellungscode(s) übrig.` }),
        ]),
      ]),
      setRow('key', 'Neue Wiederherstellungscodes', {
        sub: 'Erzeugt frische Codes; die alten werden ungültig.',
        onClick: () => regenerateModal(reload),
      }),
      setRow('logout', 'Zwei-Faktor deaktivieren', {
        sub: 'Braucht dein Passwort und einen Code.',
        onClick: () => disableModal(reload),
      }),
    );
  } else {
    host.append(
      el('p', { class: 'hint', style: { margin: '2px 0 10px' },
        text: 'Schütze dein Konto zusätzlich mit einem 6-stelligen Code aus einer ' +
          'Authenticator-App (Google Authenticator, Aegis, 1Password …).' }),
      el('button', { class: 'btn primary', onClick: () => setupWizard(reload) },
        [icon('shield', 'sm'), 'Aktivieren']),
    );
  }
}

// The setup wizard: setup → show QR + secret → confirm a code → recovery codes.
async function setupWizard(reload) {
  let data;
  try { data = await api.post('/me/2fa/setup'); }
  catch (e) { toast(e.message || 'Fehlgeschlagen', 'err'); return; }

  const canvas = el('canvas', { class: 'sec-qr' });
  try { QR.toCanvas(canvas, data.otpauth, 200); } catch { /* fall back to secret */ }
  const err = el('div', { class: 'formerr' });
  const code = el('input', { class: 'input', inputmode: 'numeric', maxlength: '6',
    placeholder: '123456', style: { letterSpacing: '0.3em', textAlign: 'center' } });
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });

  const confirm = el('button', { class: 'btn primary' }, 'Aktivieren');
  confirm.addEventListener('click', async () => {
    if (code.value.length !== 6) { err.textContent = 'Bitte gib den 6-stelligen Code ein.'; return; }
    err.textContent = ''; confirm.disabled = true;
    try {
      const r = await api.post('/me/2fa/enable', { code: code.value });
      m.close();
      showRecoveryCodes(r.recoveryCodes, reload, true);
    } catch (e) { err.textContent = e.message; confirm.disabled = false; }
  });
  code.addEventListener('keydown', (e) => e.key === 'Enter' && confirm.click());

  const m = modal({
    title: 'Zwei-Faktor einrichten',
    width: '460px',
    body: (b) => b.append(
      el('ol', { class: 'sec-steps' }, [
        el('li', { text: 'Scanne den QR-Code mit deiner Authenticator-App.' }),
        el('li', { text: 'Gib den dort angezeigten 6-stelligen Code ein.' }),
      ]),
      el('div', { class: 'sec-qr-wrap' }, canvas),
      el('div', { class: 'sec-secret' }, [
        el('span', { class: 'hint', text: 'Kein Scan möglich? Schlüssel manuell eingeben:' }),
        el('code', { class: 'sec-secret-code', text: data.secret }),
        el('button', { class: 'btn ghost sm', onClick: () => copy(data.secret) },
          [icon('copy', 'sm'), 'Kopieren']),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Code aus der App' }), code]),
      err,
    ),
    foot: [confirm],
  });
  setTimeout(() => code.focus(), 50);
}

function disableModal(reload) {
  const err = el('div', { class: 'formerr' });
  const pw = el('input', { class: 'input', type: 'password', placeholder: 'Passwort',
    autocomplete: 'current-password' });
  const code = el('input', { class: 'input', placeholder: 'Code oder Wiederherstellungscode' });
  const btn = el('button', { class: 'btn danger' }, 'Deaktivieren');
  btn.addEventListener('click', async () => {
    err.textContent = ''; btn.disabled = true;
    try {
      await api.post('/me/2fa/disable', { password: pw.value, code: code.value.trim() || undefined });
      toast('Zwei-Faktor deaktiviert.', 'ok'); m.close(); reload();
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  });
  const m = modal({
    title: 'Zwei-Faktor deaktivieren',
    width: '420px',
    body: (b) => b.append(
      el('p', { class: 'hint', style: { marginTop: '0' },
        text: 'Bestätige mit deinem Passwort und einem aktuellen Code.' }),
      el('div', { class: 'field' }, [el('label', { text: 'Passwort' }), pw]),
      el('div', { class: 'field' }, [el('label', { text: 'Code' }), code]),
      err,
    ),
    foot: [btn],
  });
}

function regenerateModal(reload) {
  const err = el('div', { class: 'formerr' });
  const pw = el('input', { class: 'input', type: 'password', placeholder: 'Passwort',
    autocomplete: 'current-password' });
  const btn = el('button', { class: 'btn primary' }, 'Neue Codes erzeugen');
  btn.addEventListener('click', async () => {
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api.post('/me/2fa/recovery', { password: pw.value });
      m.close(); showRecoveryCodes(r.recoveryCodes, reload, false);
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  });
  const m = modal({
    title: 'Neue Wiederherstellungscodes',
    width: '420px',
    body: (b) => b.append(
      el('p', { class: 'hint', style: { marginTop: '0' },
        text: 'Die bisherigen Codes werden ungültig. Bestätige mit deinem Passwort.' }),
      el('div', { class: 'field' }, [el('label', { text: 'Passwort' }), pw]), err,
    ),
    foot: [btn],
  });
}

// The one-and-only chance to see the recovery codes — force the user to copy or
// download before closing.
function showRecoveryCodes(codes, reload, firstTime) {
  const grid = el('div', { class: 'sec-codes' }, codes.map((c) => el('code', { text: c })));
  const text = codes.join('\n');
  const m = modal({
    title: 'Wiederherstellungscodes',
    width: '440px',
    body: (b) => b.append(
      firstTime
        ? el('div', { class: 'sec-banner ok' }, [icon('check', 'sm'),
            'Zwei-Faktor ist jetzt aktiv.'])
        : null,
      el('p', { class: 'hint', style: { marginTop: firstTime ? '8px' : '0' },
        text: 'Bewahre diese Codes sicher auf. Jeder funktioniert einmal, falls du ' +
          'keinen Zugriff auf deine App hast.' }),
      grid,
      el('div', { class: 'sec-codes-actions' }, [
        el('button', { class: 'btn ghost sm', onClick: () => copy(text) },
          [icon('copy', 'sm'), 'Kopieren']),
        el('button', { class: 'btn ghost sm', onClick: () => download('ping-recovery-codes.txt', text) },
          [icon('download', 'sm'), 'Herunterladen']),
      ]),
    ),
    // onClose is the single source of truth for the post-change refresh, so it
    // runs exactly once however the dialog is dismissed (button, X, Esc).
    foot: [el('button', { class: 'btn primary', onClick: () => m.close() }, 'Fertig')],
    onClose: reload,
  });
}

// ---- Security log ----------------------------------------------------------
function paintLog(host, events) {
  clear(host);
  if (!events || !events.length) {
    host.append(el('div', { class: 'hint', text: 'Noch keine Ereignisse.' }));
    return;
  }
  for (const e of events) {
    host.append(el('div', { class: 'sec-event' }, [
      el('div', { class: 'sec-event-dot', dataset: { type: e.type } }, icon(iconForEvent(e.type), 'sm')),
      el('div', { class: 'sec-event-main' }, [
        el('div', { class: 'sec-event-label', text: e.label + (e.detail ? ` · ${e.detail}` : '') }),
        el('div', { class: 'sec-event-meta', text: metaLine(e) }),
      ]),
    ]));
  }
}

function iconForEvent(type) {
  if (type.startsWith('login')) return 'logout';
  if (type.startsWith('twofa') || type.startsWith('recovery')) return 'shield';
  if (type === 'password_changed' || type === 'email_changed') return 'lock';
  if (type === 'username_changed') return 'hash';
  if (type === 'privacy_changed') return 'eye';
  if (type === 'sessions_revoked') return 'logout';
  return 'shield';
}

function metaLine(e) {
  const parts = [relTime(e.createdAt)];
  if (e.ip) parts.push(e.ip);
  return parts.join(' · ');
}

function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} h`;
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---- small helpers ---------------------------------------------------------
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert.', 'ok'); }
  catch { toast('Kopieren nicht möglich.', 'err'); }
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
