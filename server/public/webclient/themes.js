/* themes.js — "Theme Studio": curated one-tap looks plus a custom accent and a
   portable theme code. A preset bundles an accent colour, a chat wallpaper and a
   bubble shape so a coherent look is one click away instead of three separate
   pickers. encodeTheme()/decodeTheme() round-trip the look into a short shareable
   string ("ping-theme:…") so you can move it between devices or hand it to a
   friend.

   Everything routes through prefs (device-local, no server), and prefs.set()
   already re-applies the visuals live, so the preview is instant. encode/decode
   are pure + side-effect-free for easy unit testing. */

/* global Buffer -- used only as a non-browser base64 fallback (Node/test); in
   the browser btoa/atob always exist, so the Buffer branch is dead there. */

import * as prefs from './prefs.js';
import { el, icon, toast, modal } from './ui.js';

// Keys a theme owns. Anything outside this list is never touched by import.
export const THEME_KEYS = ['theme', 'accent', 'wallpaper', 'bubbleStyle', 'fontFamily'];

// Curated presets. `wallpaper` references prefs.WALLPAPERS ids.
export const PRESETS = [
  { id: 'midnight', label: 'Mitternacht', theme: 'dark', accent: '#4d9bff', wallpaper: '', bubbleStyle: 'rounded' },
  { id: 'aurora', label: 'Aurora', theme: 'dark', accent: '#7b6cff', wallpaper: 'aurora', bubbleStyle: 'rounded' },
  { id: 'sunset', label: 'Sonnenuntergang', theme: 'dark', accent: '#ff8a5b', wallpaper: 'sunset', bubbleStyle: 'rounded' },
  { id: 'forest', label: 'Wald', theme: 'dark', accent: '#34d399', wallpaper: 'forest', bubbleStyle: 'rounded' },
  { id: 'rose', label: 'Rosé', theme: 'dark', accent: '#f472b6', wallpaper: 'sunset', bubbleStyle: 'rounded' },
  { id: 'slate', label: 'Schiefer', theme: 'dark', accent: '#60a5fa', wallpaper: 'mono', bubbleStyle: 'square' },
  { id: 'daylight', label: 'Tageslicht', theme: 'light', accent: '#2f6fed', wallpaper: '', bubbleStyle: 'rounded' },
  { id: 'paper', label: 'Papier', theme: 'light', accent: '#b4824a', wallpaper: '', bubbleStyle: 'square' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const CODE_PREFIX = 'ping-theme:';

/** Snapshot the current look as a plain theme object. */
export function currentTheme() {
  const out = {};
  for (const k of THEME_KEYS) out[k] = prefs.get(k);
  return out;
}

/** base64url(JSON) of a theme, prefixed so it's recognisable when pasted. */
export function encodeTheme(theme = currentTheme()) {
  const clean = {};
  for (const k of THEME_KEYS) if (k in theme) clean[k] = theme[k];
  const json = JSON.stringify(clean);
  const b64 = (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, 'utf8').toString('base64'));
  return CODE_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parse a theme code back into a validated theme object (throws on garbage). */
export function decodeTheme(code) {
  const raw = String(code || '').trim().replace(/^ping-theme:/i, '');
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  let json;
  try {
    json = (typeof atob === 'function' ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8'));
  } catch { throw new Error('Ungültiger Theme-Code.'); }
  let obj;
  try { obj = JSON.parse(json); } catch { throw new Error('Ungültiger Theme-Code.'); }
  if (!obj || typeof obj !== 'object') throw new Error('Ungültiger Theme-Code.');
  return sanitizeTheme(obj);
}

/** Keep only known, well-formed values — defends against a pasted code that
    tries to smuggle in unexpected keys or malformed colours. */
export function sanitizeTheme(obj) {
  const out = {};
  if (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system') out.theme = obj.theme;
  if (typeof obj.accent === 'string' && HEX.test(obj.accent)) out.accent = obj.accent;
  if (typeof obj.wallpaper === 'string') {
    const ok = obj.wallpaper === '' || obj.wallpaper.startsWith('data:image/')
      || prefs.WALLPAPERS.some((w) => w.id === obj.wallpaper);
    if (ok) out.wallpaper = obj.wallpaper.slice(0, 200000);
  }
  if (obj.bubbleStyle === 'rounded' || obj.bubbleStyle === 'square') out.bubbleStyle = obj.bubbleStyle;
  if (prefs.FONTS.some((f) => f[0] === obj.fontFamily)) out.fontFamily = obj.fontFamily;
  return out;
}

/** Apply a theme object to prefs (live). Only known keys move. */
export function applyTheme(theme) {
  const safe = sanitizeTheme(theme);
  for (const [k, v] of Object.entries(safe)) prefs.set(k, v);
  return safe;
}

export const applyPreset = (p) => applyTheme(p);

/** True if the live look matches a preset exactly (to highlight it). */
export function activePresetId() {
  const cur = currentTheme();
  const match = PRESETS.find((p) => THEME_KEYS.every((k) => (p[k] ?? '') === (cur[k] ?? '')));
  return match?.id || null;
}

// ---- UI: rendered inside the settings "Design" category -------------------
export function renderThemeStudio(container, onChange = () => {}) {
  const grid = el('div', { class: 'theme-grid' });
  const paintGrid = () => {
    grid.replaceChildren(...PRESETS.map((p) => {
      const active = activePresetId() === p.id;
      const sw = el('button', { class: `theme-card ${active ? 'active' : ''}`, type: 'button',
        title: p.label, onClick: () => { applyPreset(p); paintGrid(); onChange(); } }, [
        el('span', { class: 'theme-swatch', style: { background: swatchBg(p) } },
          el('span', { class: 'theme-bubble', style: { background: p.accent } })),
        el('span', { class: 'theme-name', text: p.label }),
      ]);
      return sw;
    }));
  };
  paintGrid();

  // Theme code import/export — declared first so the accent handler can refresh it.
  const codeField = el('input', { class: 'input mono', type: 'text', readonly: 'true',
    value: encodeTheme(), 'aria-label': 'Theme-Code' });

  // Custom accent
  const hexInput = el('input', { class: 'input mono', type: 'text', value: prefs.get('accent'),
    maxlength: '7', 'aria-label': 'Akzentfarbe (Hex)' });
  const colorInput = el('input', { type: 'color', value: prefs.get('accent'), 'aria-label': 'Akzentfarbe wählen' });
  const syncAccent = (v) => {
    if (!HEX.test(v)) return;
    prefs.set('accent', v); hexInput.value = v; colorInput.value = v;
    codeField.value = encodeTheme(); paintGrid(); onChange();
  };
  colorInput.addEventListener('input', () => syncAccent(colorInput.value));
  hexInput.addEventListener('change', () => syncAccent(hexInput.value.trim()));
  const copyBtn = el('button', { class: 'btn ghost sm', type: 'button', onClick: async () => {
    try { await navigator.clipboard.writeText(codeField.value); toast('Theme-Code kopiert.', 'ok'); }
    catch { codeField.select?.(); toast('Code markiert – mit Strg+C kopieren.'); }
  } }, [icon('copy', 'sm'), el('span', { text: 'Kopieren' })]);
  const importField = el('input', { class: 'input mono', type: 'text', placeholder: 'ping-theme:… einfügen',
    'aria-label': 'Theme-Code importieren' });
  const importBtn = el('button', { class: 'btn primary sm', type: 'button', onClick: () => {
    try {
      applyTheme(decodeTheme(importField.value));
      importField.value = ''; codeField.value = encodeTheme();
      paintGrid(); onChange(); toast('Theme übernommen.', 'ok');
    } catch (e) { toast(e.message || 'Ungültiger Code.', 'err'); }
  } }, 'Übernehmen');

  container.append(
    el('div', { class: 'studio-block' }, [
      el('div', { class: 'studio-label', text: 'Vorlagen' }), grid,
    ]),
    el('div', { class: 'studio-block' }, [
      el('div', { class: 'studio-label', text: 'Eigene Akzentfarbe' }),
      el('div', { class: 'studio-accent' }, [colorInput, hexInput]),
    ]),
    el('div', { class: 'studio-block' }, [
      el('div', { class: 'studio-label', text: 'Theme teilen' }),
      el('div', { class: 'studio-code' }, [codeField, copyBtn]),
      el('div', { class: 'studio-code' }, [importField, importBtn]),
    ]),
  );
}

function swatchBg(p) {
  const wp = prefs.WALLPAPERS.find((w) => w.id === p.wallpaper);
  if (wp && wp.css) return wp.css;
  return p.theme === 'light' ? '#eef1f6' : '#0c111b';
}

/** Open Theme Studio as a standalone modal (used from settings + the palette). */
export function openThemeStudio() {
  modal({ title: 'Theme Studio', width: '520px', body: (b) => renderThemeStudio(b) });
}
