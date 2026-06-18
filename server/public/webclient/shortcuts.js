/* shortcuts.js — a single, discoverable cheat-sheet for every keyboard shortcut
   in Ping Web. Power users live on the keyboard; surfacing the bindings (press
   "?") turns hidden affordances into something learnable. The list here is the
   documentation — the actual key handling lives in app.js / chat.js; this module
   only renders the reference, so the two are intentionally kept side by side in
   the changelog whenever a binding changes. */

import { el, modal } from './ui.js';

// '⌘' on Apple platforms, 'Strg' elsewhere — match what the user actually presses.
function modKey() {
  try {
    const p = navigator.platform || navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/.test(p) ? '⌘' : 'Strg';
  } catch { return 'Strg'; }
}

export function shortcutGroups() {
  const M = modKey();
  return [
    ['Allgemein', [
      [[M, 'K'], 'Befehlspalette öffnen'],
      [['?'], 'Diese Tastenkürzel anzeigen'],
      [[M, ','], 'Einstellungen'],
      [[M, 'N'], 'Neuer Chat'],
      [[M, '⇧', 'D'], 'Debug & Diagnose'],
    ]],
    ['Navigation', [
      [['Alt', '↓'], 'Nächster Chat'],
      [['Alt', '↑'], 'Vorheriger Chat'],
      [['Esc'], 'Schließen / zurück'],
    ]],
    ['Im Chat', [
      [[M, 'F'], 'In der Unterhaltung suchen'],
      [['Enter'], 'Senden (umschaltbar)'],
      [['⇧', 'Enter'], 'Zeilenumbruch'],
      [['@'], 'Mitglied erwähnen (Gruppen)'],
    ]],
  ];
}

let openFlag = false;
export function shortcutsOpen() { return openFlag; }

export function openShortcuts() {
  if (openFlag) return;
  openFlag = true;
  const body = el('div', { class: 'shortcuts' });
  for (const [section, rows] of shortcutGroups()) {
    body.append(el('div', { class: 'sc-section', text: section }));
    for (const [keys, label] of rows) {
      body.append(el('div', { class: 'sc-row' }, [
        el('div', { class: 'sc-keys' }, keys.map((k) => el('kbd', { text: k }))),
        el('div', { class: 'sc-label', text: label }),
      ]));
    }
  }
  modal({ title: 'Tastenkürzel', body, width: '440px', onClose: () => { openFlag = false; } });
}
