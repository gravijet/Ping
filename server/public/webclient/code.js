/* code.js — "Code-Snippet" message type (0.35.0). A snippet is a structured
   message (type 'code'); its source rides along in message.code. This module
   owns the composer modal, the in-chat card (highlighted preview + one-tap
   copy), and a fullscreen viewer with copy + download. Highlighting is done by
   the dependency-free codehl.js, so there's no build step and nothing to ship. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';
import { highlight, resolveLang } from './codehl.js';

const PREVIEW_LINES = 14;
const EXT = { js: 'js', ts: 'ts', py: 'py', sql: 'sql', bash: 'sh', rust: 'rs', go: 'go', json: 'json', css: 'css', html: 'html', java: 'java' };

/** Modal to compose + send a code snippet to [chatId]. */
export function newCodeModal(chatId) {
  const lang = el('input', { class: 'input', placeholder: 'Sprache (z. B. js, python, sql)', maxlength: '24' });
  const file = el('input', { class: 'input', placeholder: 'Dateiname (optional)', maxlength: '120' });
  const code = el('textarea', { class: 'input code-compose', placeholder: 'Code hier einfügen …', rows: '12', spellcheck: 'false' });
  code.setAttribute('autocapitalize', 'off');
  code.setAttribute('autocomplete', 'off');
  const err = el('div', { class: 'formerr' });
  const count = el('div', { class: 'hint code-count', text: '0 Zeilen' });
  // Tab inserts two spaces instead of moving focus — it's a code box, after all.
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = code.selectionStart, en = code.selectionEnd;
      code.value = code.value.slice(0, s) + '  ' + code.value.slice(en);
      code.selectionStart = code.selectionEnd = s + 2;
    }
  });
  code.addEventListener('input', () => {
    const lines = code.value ? code.value.split('\n').length : 0;
    count.textContent = `${lines} ${lines === 1 ? 'Zeile' : 'Zeilen'}`;
  });

  const m = modal({
    title: 'Code teilen',
    width: 560,
    body: (b) => b.append(
      el('div', { class: 'code-compose-meta' }, [lang, file]),
      code,
      count,
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: send }, [icon('code'), 'Senden'])],
  });
  setTimeout(() => code.focus(), 50);

  async function send() {
    err.textContent = '';
    const body = code.value.replace(/\s+$/, '');
    if (!body.trim()) { err.textContent = 'Der Code ist leer.'; return; }
    if (body.length > 20000) { err.textContent = 'Das Snippet ist zu lang (max. 20.000 Zeichen).'; return; }
    try {
      await api.post(`/chats/${chatId}/code`, {
        code: body,
        language: lang.value.trim(),
        filename: file.value.trim(),
      });
      telemetry.track('code_send', { lang: resolveLang(lang.value) || 'plain', lines: body.split('\n').length });
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte das Snippet nicht senden.'; }
  }
}

function label(c) {
  return c.filename || (c.language ? c.language : 'Code');
}

/** Render the in-chat code card for message [m]. */
export function renderCode(m) {
  const c = m.code || { code: '', language: '', filename: '', lines: 0 };
  const card = el('div', { class: 'code-card' });

  const copyBtn = el('button', { class: 'iconbtn sm', title: 'Code kopieren',
    onClick: (e) => { e.stopPropagation(); copy(c.code); } }, icon('copy', 'sm'));
  card.append(el('div', { class: 'code-head' }, [
    icon('code', 'sm'),
    el('div', { class: 'code-lang', text: label(c) }),
    el('div', { class: 'code-lines', text: `${c.lines || 0} ${c.lines === 1 ? 'Zeile' : 'Zeilen'}` }),
    copyBtn,
  ]));

  const lines = (c.code || '').split('\n');
  const shown = lines.slice(0, PREVIEW_LINES).join('\n');
  const pre = el('pre', { class: 'code-pre' });
  pre.appendChild(el('code', { html: highlight(shown, c.language) }));
  card.append(pre);

  if (lines.length > PREVIEW_LINES) {
    card.append(el('button', { class: 'code-more', onClick: () => openCodeViewer(m) },
      `… ${lines.length - PREVIEW_LINES} weitere Zeilen anzeigen`));
  }
  // Clicking the body (not a button) opens the full viewer.
  pre.addEventListener('click', () => openCodeViewer(m));
  return card;
}

/** Fullscreen viewer: full highlighted source with copy + download. */
export function openCodeViewer(m) {
  const c = m.code || { code: '', language: '', filename: '' };
  const pre = el('pre', { class: 'code-pre full' });
  pre.appendChild(el('code', { html: highlight(c.code || '', c.language) }));

  modal({
    title: label(c),
    width: 820,
    body: (b) => {
      b.classList.add('code-viewer-body');
      b.append(pre);
    },
    foot: [
      el('button', { class: 'btn ghost', onClick: () => download(c) }, [icon('download'), 'Speichern']),
      el('button', { class: 'btn primary', onClick: () => copy(c.code) }, [icon('copy'), 'Kopieren']),
    ],
  });
}

function copy(text) {
  navigator.clipboard?.writeText(text || '')
    .then(() => toast('Code kopiert.', 'ok'))
    .catch(() => toast('Kopieren nicht möglich.', 'err'));
}

function download(c) {
  try {
    const ext = EXT[resolveLang(c.language)] || 'txt';
    const name = c.filename || `snippet.${ext}`;
    const blob = new Blob([c.code || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast('Download nicht möglich.', 'err'); }
}
