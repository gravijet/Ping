/* devices.js — link another device to this account. The new device shows a code
   (its "Mit dem Handy verknüpfen" screen calls POST /auth/link/start); this
   already-signed-in session approves it via POST /auth/link/approve. Mirrors the
   native app's "device linking" without needing a camera. */

import { api } from './api.js';
import { el, icon, modal, toast } from './ui.js';

export function linkDeviceModal() {
  const err = el('div', { class: 'formerr' });
  const code = el('input', { class: 'input', placeholder: 'z. B. 4F9K-2A7C', autocomplete: 'off', spellcheck: 'false' });
  const m = modal({
    title: 'Gerät verknüpfen',
    body: (b) => b.append(
      el('p', { class: 'hint', style: { lineHeight: '1.6' },
        text: 'Öffne Ping auf dem neuen Gerät und wähle „Mit dem Handy verknüpfen“. ' +
          'Gib den dort angezeigten Code hier ein, um es bei deinem Konto anzumelden.' }),
      el('div', { class: 'field', style: { marginTop: '12px' } }, [el('label', { text: 'Verknüpfungscode' }), code]),
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: submit }, [icon('link'), 'Verknüpfen'])],
  });
  setTimeout(() => code.focus(), 0);
  code.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  async function submit() {
    err.textContent = '';
    let raw = code.value.trim();
    if (raw.startsWith('ping-link:')) raw = raw.slice('ping-link:'.length);
    if (!raw) { err.textContent = 'Bitte einen Code eingeben.'; return; }
    try {
      await api.post('/auth/link/approve', { code: raw, deviceLabel: 'Verknüpft über Ping Web' });
      m.close(); toast('Gerät verknüpft.', 'ok');
    } catch (e) { err.textContent = e.message; }
  }
}
