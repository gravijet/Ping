/* auth.js — the signed-out experience: login, registration (phone → SMS code →
   account), password reset, and optional WhatsApp-style QR device linking.
   On success it calls onAuthed(token, user) and the shell takes over. */

import { api } from './api.js';
import { el, clear, icon, toast } from './ui.js';
import { QR } from './vendor/qrcode.min.js';

export function renderAuth(root, onAuthed) {
  const panel = el('div', { class: 'auth-panel' });
  const screen = el('div', { class: 'auth' }, [hero(), panel]);
  clear(root).appendChild(screen);
  showLogin(panel, onAuthed);
}

function hero() {
  const feat = (ic, t) => el('div', { class: 'auth-feat' }, [icon(ic), el('span', { text: t })]);
  return el('div', { class: 'auth-hero' }, [
    el('h1', { html: '<span class="accent">Ping</span> Web' }),
    el('p', { text: 'Dein Messenger – jetzt im Browser, optimiert für den großen ' +
      'Bildschirm. Schreib, telefoniere und teile direkt vom PC.' }),
    el('div', { class: 'auth-feats' }, [
      feat('bolt', 'Nachrichten in Echtzeit, überall synchron'),
      feat('group', 'Gruppen, Reaktionen, Status & Medien'),
      feat('phone', 'Sprach- und Videoanrufe direkt im Browser'),
      feat('shield', 'Same-Origin, kein Tracking, kein CDN'),
    ]),
  ]);
}

function card(title, sub, children, tabsOn) {
  return el('div', { class: 'auth-card' }, [
    el('div', { class: 'auth-tabs' }, [
      tab('Anmelden', tabsOn === 'login'),
      tab('Registrieren', tabsOn === 'register'),
    ]),
    el('h2', { text: title }),
    el('p', { class: 'auth-sub', text: sub }),
    ...children,
  ]);
}
function tab(label, on) { return el('button', { class: `auth-tab ${on ? 'on' : ''}`,
  'data-tab': label }, label); }

function mount(panel, node) { clear(panel).appendChild(node); }

function wireTabs(node, panel, onAuthed) {
  node.querySelectorAll('.auth-tab').forEach((t) => {
    t.addEventListener('click', () => {
      if (t.dataset.tab === 'Anmelden') showLogin(panel, onAuthed);
      else showRegister(panel, onAuthed);
    });
  });
}

// ---- login ----------------------------------------------------------------
function showLogin(panel, onAuthed) {
  const err = el('div', { class: 'formerr' });
  const login = el('input', { class: 'input', placeholder: '+43 660 1234567 oder E-Mail',
    autocomplete: 'username' });
  const pw = el('input', { class: 'input', type: 'password', placeholder: 'Passwort',
    autocomplete: 'current-password' });
  const btn = el('button', { class: 'btn primary block' }, 'Anmelden');

  const submit = async () => {
    err.textContent = '';
    if (!login.value.trim() || !pw.value) { err.textContent = 'Bitte alles ausfüllen.'; return; }
    btn.disabled = true; btn.textContent = 'Anmelden …';
    try {
      const r = await api.post('/auth/login', { login: login.value.trim(), password: pw.value });
      // 2FA: a correct password returns a challenge, not a session. Go collect
      // the code rather than signing in.
      if (r.twoFactorRequired) { showTwoFactor(panel, onAuthed, r.challenge); return; }
      onAuthed(r.token, r.user);
    } catch (e) {
      err.textContent = e.message; btn.disabled = false; btn.textContent = 'Anmelden';
    }
  };
  btn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const node = card('Willkommen zurück', 'Melde dich mit Nummer/E-Mail und Passwort an.', [
    el('div', { class: 'field' }, [el('label', { text: 'Nummer oder E-Mail' }), login]),
    el('div', { class: 'field' }, [el('label', { text: 'Passwort' }), pw]),
    err, btn,
    el('div', { class: 'auth-foot' }, [
      el('button', { class: 'linklike', onClick: () => showReset(panel, onAuthed) },
        'Passwort vergessen?'),
    ]),
    el('div', { class: 'auth-or', text: 'oder' }),
    el('button', { class: 'btn block', onClick: () => showQr(panel, onAuthed) },
      [icon('qr'), 'Mit dem Handy verknüpfen']),
  ], 'login');
  mount(panel, node); wireTabs(node, panel, onAuthed);
}

// ---- two-factor challenge (step 2 of login) -------------------------------
function showTwoFactor(panel, onAuthed, challenge) {
  let recovery = false;
  const err = el('div', { class: 'formerr' });
  const code = el('input', {
    class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code',
    placeholder: '123456', maxlength: '6',
    style: { letterSpacing: '0.4em', textAlign: 'center', fontSize: '1.3rem' },
  });
  const btn = el('button', { class: 'btn primary block' }, 'Bestätigen');
  const toggle = el('button', { class: 'linklike' }, 'Stattdessen Wiederherstellungscode');

  const submit = async () => {
    err.textContent = '';
    const val = code.value.trim();
    if (!val) { err.textContent = 'Bitte gib deinen Code ein.'; return; }
    btn.disabled = true; btn.textContent = 'Prüfe …';
    try {
      const body = recovery ? { challenge, recoveryCode: val } : { challenge, code: val };
      const r = await api.post('/auth/login/2fa', body);
      onAuthed(r.token, r.user);
    } catch (e) {
      err.textContent = e.message; btn.disabled = false; btn.textContent = 'Bestätigen';
    }
  };
  btn.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  // TOTP fields only accept digits; recovery codes are alphanumeric + dashes.
  code.addEventListener('input', () => {
    if (!recovery) code.value = code.value.replace(/\D/g, '').slice(0, 6);
  });
  toggle.addEventListener('click', () => {
    recovery = !recovery;
    code.value = '';
    if (recovery) {
      code.placeholder = 'xxxx-xxxx'; code.maxLength = 40; code.inputMode = 'text';
      code.style.letterSpacing = '0.1em'; code.style.fontSize = '1.05rem';
      toggle.textContent = 'Stattdessen App-Code';
      label.textContent = 'Wiederherstellungscode';
    } else {
      code.placeholder = '123456'; code.maxLength = 6; code.inputMode = 'numeric';
      code.style.letterSpacing = '0.4em'; code.style.fontSize = '1.3rem';
      toggle.textContent = 'Stattdessen Wiederherstellungscode';
      label.textContent = 'Code aus deiner Authenticator-App';
    }
    code.focus();
  });

  const label = el('label', { text: 'Code aus deiner Authenticator-App' });
  const node = el('div', { class: 'auth-card' }, [
    el('h2', { text: 'Bestätigung in zwei Schritten' }),
    el('p', { class: 'auth-sub', text: 'Gib den 6-stelligen Code aus deiner ' +
      'Authenticator-App ein, um die Anmeldung abzuschließen.' }),
    el('div', { class: 'field' }, [label, code]),
    err, btn,
    el('div', { class: 'auth-foot' }, [
      toggle,
      el('button', { class: 'linklike', onClick: () => showLogin(panel, onAuthed) },
        '← Zurück'),
    ]),
  ]);
  mount(panel, node);
  setTimeout(() => code.focus(), 50);
}

// ---- register -------------------------------------------------------------
function showRegister(panel, onAuthed) {
  const err = el('div', { class: 'formerr' });
  const name = el('input', { class: 'input', placeholder: 'Dein Name', autocomplete: 'name' });
  const phone = el('input', { class: 'input', placeholder: '+43 660 1234567', autocomplete: 'tel' });
  const email = el('input', { class: 'input', type: 'email', placeholder: 'user@example.invalid',
    autocomplete: 'email' });
  const pw = el('input', { class: 'input', type: 'password', placeholder: 'Mind. 8 Zeichen',
    autocomplete: 'new-password' });
  const btn = el('button', { class: 'btn primary block' }, 'Code anfordern');

  const next = async () => {
    err.textContent = '';
    if (!name.value.trim() || !phone.value.trim() || !email.value.trim() || !pw.value) {
      err.textContent = 'Bitte alle Felder ausfüllen.'; return;
    }
    if (pw.value.length < 8) { err.textContent = 'Das Passwort braucht mind. 8 Zeichen.'; return; }
    btn.disabled = true; btn.textContent = 'Sende Code …';
    try {
      const r = await api.post('/auth/request-code', { phone: phone.value.trim(),
        purpose: 'register' });
      showVerify(panel, onAuthed, {
        displayName: name.value.trim(), phone: r.phone, email: email.value.trim(),
        password: pw.value, devCode: r.devCode,
      });
    } catch (e) {
      err.textContent = e.message; btn.disabled = false; btn.textContent = 'Code anfordern';
    }
  };
  btn.addEventListener('click', next);

  const node = card('Konto erstellen', 'Erstelle dein Ping-Konto direkt im Browser.', [
    el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
    el('div', { class: 'field' }, [el('label', { text: 'Handynummer' }), phone]),
    el('div', { class: 'field' }, [el('label', { text: 'E-Mail' }), email]),
    el('div', { class: 'field' }, [el('label', { text: 'Passwort' }), pw]),
    err, btn,
  ], 'register');
  mount(panel, node); wireTabs(node, panel, onAuthed);
}

function showVerify(panel, onAuthed, data) {
  const err = el('div', { class: 'formerr' });
  const code = el('input', { class: 'input', placeholder: '6-stelliger Code',
    inputmode: 'numeric', maxlength: '8' });
  const btn = el('button', { class: 'btn primary block' }, 'Konto erstellen');

  const submit = async () => {
    err.textContent = '';
    if (!code.value.trim()) { err.textContent = 'Bitte gib den Code ein.'; return; }
    btn.disabled = true; btn.textContent = 'Erstelle Konto …';
    try {
      const v = await api.post('/auth/verify-code', { phone: data.phone, code: code.value.trim() });
      const r = await api.post('/auth/register', {
        phone: data.phone, email: data.email, password: data.password,
        displayName: data.displayName, verifyToken: v.verifyToken,
      });
      onAuthed(r.token, r.user);
    } catch (e) {
      err.textContent = e.message; btn.disabled = false; btn.textContent = 'Konto erstellen';
    }
  };
  btn.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const kids = [
    el('div', { class: 'field' }, [el('label', { text: 'SMS-Code' }), code]),
    data.devCode ? el('div', { class: 'devcode',
      html: `Test-Modus – dein Code: <b>${data.devCode}</b>` }) : null,
    err, btn,
    el('div', { class: 'auth-foot' }, [
      el('button', { class: 'linklike', onClick: () => showRegister(panel, onAuthed) },
        '← Zurück'),
    ]),
  ];
  const node = el('div', { class: 'auth-card' }, [
    el('h2', { text: 'Nummer bestätigen' }),
    el('p', { class: 'auth-sub', text: `Wir haben einen Code an ${data.phone} gesendet.` }),
    ...kids.filter(Boolean),
  ]);
  mount(panel, node);
  code.focus();
}

// ---- password reset -------------------------------------------------------
function showReset(panel, onAuthed) {
  const err = el('div', { class: 'formerr' });
  const phone = el('input', { class: 'input', placeholder: '+43 660 1234567' });
  const btn = el('button', { class: 'btn primary block' }, 'Code anfordern');
  const submit = async () => {
    err.textContent = '';
    if (!phone.value.trim()) { err.textContent = 'Bitte gib deine Nummer ein.'; return; }
    btn.disabled = true; btn.textContent = 'Sende Code …';
    try {
      const r = await api.post('/auth/request-code', { phone: phone.value.trim(), purpose: 'reset' });
      showResetCode(panel, onAuthed, { phone: r.phone, devCode: r.devCode });
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Code anfordern'; }
  };
  btn.addEventListener('click', submit);
  const node = el('div', { class: 'auth-card' }, [
    el('h2', { text: 'Passwort zurücksetzen' }),
    el('p', { class: 'auth-sub', text: 'Wir senden dir einen Code per SMS.' }),
    el('div', { class: 'field' }, [el('label', { text: 'Handynummer' }), phone]),
    err, btn,
    el('div', { class: 'auth-foot' }, [
      el('button', { class: 'linklike', onClick: () => showLogin(panel, onAuthed) }, '← Zurück'),
    ]),
  ]);
  mount(panel, node);
}
function showResetCode(panel, onAuthed, data) {
  const err = el('div', { class: 'formerr' });
  const code = el('input', { class: 'input', placeholder: 'SMS-Code', inputmode: 'numeric' });
  const pw = el('input', { class: 'input', type: 'password', placeholder: 'Neues Passwort' });
  const btn = el('button', { class: 'btn primary block' }, 'Passwort setzen');
  const submit = async () => {
    err.textContent = '';
    if (!code.value.trim() || pw.value.length < 8) {
      err.textContent = 'Code eingeben und mind. 8 Zeichen Passwort.'; return;
    }
    btn.disabled = true; btn.textContent = 'Speichere …';
    try {
      const v = await api.post('/auth/verify-code', { phone: data.phone, code: code.value.trim() });
      const r = await api.post('/auth/reset-password', { phone: data.phone,
        verifyToken: v.verifyToken, password: pw.value });
      onAuthed(r.token, r.user);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Passwort setzen'; }
  };
  btn.addEventListener('click', submit);
  const node = el('div', { class: 'auth-card' }, [
    el('h2', { text: 'Neues Passwort' }),
    el('p', { class: 'auth-sub', text: `Code an ${data.phone}.` }),
    el('div', { class: 'field' }, [el('label', { text: 'SMS-Code' }), code]),
    data.devCode ? el('div', { class: 'devcode', html: `Test-Code: <b>${data.devCode}</b>` }) : null,
    el('div', { class: 'field' }, [el('label', { text: 'Neues Passwort' }), pw]),
    err, btn,
  ].filter(Boolean));
  mount(panel, node);
}

// ---- QR device linking ----------------------------------------------------
let qrPoll = null;
function showQr(panel, onAuthed) {
  clearInterval(qrPoll);
  const canvas = el('canvas');
  const status = el('div', { class: 'hint', text: 'QR-Code wird erstellt …' });
  const node = el('div', { class: 'auth-card' }, [
    el('h2', { text: 'Mit dem Handy verknüpfen' }),
    el('p', { class: 'auth-sub', text: 'Öffne Ping am Handy → Einstellungen → ' +
      '„Verknüpfte Geräte" und scanne diesen Code.' }),
    el('div', { class: 'qr-wrap' }, [el('div', { class: 'qr-box' }, canvas), status]),
    el('div', { class: 'auth-foot' }, [
      el('button', { class: 'linklike', onClick: () => { clearInterval(qrPoll);
        showLogin(panel, onAuthed); } }, '← Zurück zur Anmeldung'),
    ]),
  ]);
  mount(panel, node);

  (async () => {
    try {
      const link = await api.post('/auth/link/start');
      QR.toCanvas(canvas, `ping-link:${link.code}`, 210);
      status.textContent = 'Warte auf Bestätigung am Handy …';
      qrPoll = setInterval(async () => {
        try {
          const r = await api.get(`/auth/link/poll?linkId=${encodeURIComponent(link.linkId)}` +
            `&secret=${encodeURIComponent(link.pollSecret)}`);
          if (r.status === 'approved') { clearInterval(qrPoll); onAuthed(r.token, r.user); }
          else if (r.status === 'expired') {
            clearInterval(qrPoll); status.textContent = 'Code abgelaufen.';
            showQr(panel, onAuthed);
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      status.textContent = 'Konnte keinen Code erstellen.';
      toast(e.message || 'Fehler', 'err');
    }
  })();
}
