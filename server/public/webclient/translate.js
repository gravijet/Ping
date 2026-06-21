/* translate.js — inline message translation (0.34.0) via the server's self-hosted
   LibreTranslate proxy (private; nothing goes to a third-party cloud). Adds a
   translation line under a message bubble. Degrades gracefully when the server
   has no translation backend configured. */

import { api } from './api.js';
import { el, toast } from './ui.js';

let available = null; // null = unknown, true/false once probed

async function probe() {
  if (available !== null) return available;
  try { const r = await api.get('/translate/available'); available = !!r.available; }
  catch { available = false; }
  return available;
}

/** Whether to offer the "Übersetzen" action at all (kept cheap; probes once). */
export function translationAvailable() { probe(); return available !== false; }

/** Translate message [m]'s body into the UI language and show it under [bubble]. */
export async function translateMessage(m, bubble) {
  if (!(await probe())) { toast('Übersetzung ist nicht verfügbar.', 'err'); return; }
  const existing = bubble?.querySelector?.('.msg-translation');
  if (existing) { existing.remove(); return; } // toggle off
  const target = (navigator.language || 'de').slice(0, 2);
  const line = el('div', { class: 'msg-translation', text: 'Übersetze …' });
  bubble?.appendChild(line);
  try {
    const out = await api.post('/translate', { text: m.body || '', target });
    line.replaceChildren(
      el('span', { class: 'tr-flag', text: '🌍' }),
      el('span', { text: out.text || '' }),
      out.detected ? el('span', { class: 'tr-src', text: ` (${out.detected})` }) : null,
    );
  } catch (e) {
    line.textContent = e.message || 'Übersetzung fehlgeschlagen.';
  }
}
