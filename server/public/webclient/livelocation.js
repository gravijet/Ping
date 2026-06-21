/* livelocation.js — "Live-Standort" (0.34.0). A 'livelocation' message renders a
   card that updates as the sharer's position moves (server pushes
   'location-update' over the socket). The sharer's own browser watches geolocation
   and POSTs new positions until the timer runs out or they stop. Map-link based,
   no embedded map SDK — the link opens the platform's native maps. */

import { api } from './api.js';
import * as store from './store.js';
import { el, icon, toast } from './ui.js';

const DURATIONS = [[15, '15 Minuten'], [60, '1 Stunde'], [480, '8 Stunden']];

// Per-sharer live position cache, keyed `${chatId}:${userId}`, fed by the socket.
const live = new Map();

/** Render the in-chat live-location card for message [m]. */
export function renderLiveLocation(m) {
  const ll = m.liveLocation || {};
  const key = `${m.chatId}:${m.senderId}`;
  const cached = live.get(key);
  const pos = cached || ll;
  const card = el('div', { class: 'll-card', id: 'll-' + m.id });
  card.dataset.key = key;
  card.dataset.msg = m.id;
  paintCard(card, pos, m);
  return card;
}

function paintCard(card, pos, m) {
  card.replaceChildren();
  const active = pos.active && (!pos.expiresAt || pos.expiresAt > Date.now());
  const mine = m.senderId === store.state.me?.id;
  card.classList.toggle('inactive', !active);
  card.append(
    el('div', { class: 'll-head' }, [
      el('span', { class: `ll-dot ${active ? 'on' : ''}`, 'aria-hidden': 'true' }),
      el('span', { class: 'll-title', text: active ? 'Live-Standort' : 'Standort-Freigabe beendet' }),
    ]),
  );
  if (active && pos.lat != null) {
    const href = `https://maps.google.com/?q=${pos.lat},${pos.lng}`;
    card.append(el('a', { class: 'll-map', href, target: '_blank', rel: 'noopener' }, [
      icon('pin'), el('span', { text: 'Auf der Karte öffnen' }),
    ]));
    if (pos.updatedAt) {
      card.append(el('div', { class: 'll-meta', text: 'Aktualisiert ' + relTime(pos.updatedAt) }));
    }
    if (mine && watchers.has(m.chatId)) {
      card.append(el('button', { class: 'btn ghost sm', onClick: () => stopSharing(m.chatId) }, 'Teilen beenden'));
    }
  }
}

function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  return `vor ${Math.round(s / 3600)} Std.`;
}

// ---- sharing (the sender's side) ------------------------------------------

const watchers = new Map(); // chatId -> geolocation watch id

/** Prompt for a duration, then start sharing live location into [chatId]. */
export function startLiveLocation(chatId) {
  if (!navigator.geolocation) { toast('Standort wird nicht unterstützt.', 'err'); return; }
  import('./ui.js').then(({ modal, el: e }) => {
    const sel = e('select', { class: 'input' }, DURATIONS.map(([v, l]) => e('option', { value: String(v) }, l)));
    const dlg = modal({
      title: 'Live-Standort teilen',
      body: (b) => b.append(
        e('p', { class: 'hint', text: 'Dein Standort wird laufend mit diesem Chat geteilt, bis der Zeitraum endet oder du das Teilen beendest.' }),
        e('div', { class: 'field' }, [e('label', { text: 'Zeitraum' }), sel]),
      ),
      foot: [e('button', { class: 'btn primary', onClick: () => { dlg.close(); begin(chatId, Number(sel.value)); } }, 'Teilen starten')],
    });
  });
}

function begin(chatId, durationMinutes) {
  toast('Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(async (p) => {
    try {
      await api.post(`/chats/${chatId}/livelocation`, {
        lat: round(p.coords.latitude), lng: round(p.coords.longitude),
        accuracy: p.coords.accuracy || null, heading: p.coords.heading || null,
        durationMinutes,
      });
      toast('Live-Standort gestartet.', 'ok');
      const id = navigator.geolocation.watchPosition((q) => pushUpdate(chatId, q),
        () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
      watchers.set(chatId, id);
      // Auto-stop when the window closes.
      setTimeout(() => stopSharing(chatId), durationMinutes * 60_000);
    } catch (e) { toast(e.message || 'Konnte nicht starten.', 'err'); }
  }, () => toast('Standort nicht verfügbar.', 'err'), { enableHighAccuracy: true, timeout: 10000 });
}

async function pushUpdate(chatId, p) {
  try {
    await api.post(`/chats/${chatId}/livelocation/update`, {
      lat: round(p.coords.latitude), lng: round(p.coords.longitude),
      accuracy: p.coords.accuracy || null, heading: p.coords.heading || null,
    });
  } catch { /* a dropped update is fine; the next one reconciles */ }
}

export function stopSharing(chatId) {
  const id = watchers.get(chatId);
  if (id != null) { navigator.geolocation.clearWatch(id); watchers.delete(chatId); }
  api.post(`/chats/${chatId}/livelocation/stop`, {}).catch(() => {});
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Realtime: a 'location-update' arrived — update the matching card in place. */
export function onLocationUpdate(p) {
  const key = `${p.chatId}:${p.userId}`;
  live.set(key, p.active ? p : { active: false, updatedAt: p.updatedAt });
  for (const card of document.querySelectorAll(`.ll-card[data-key="${key}"]`)) {
    paintCard(card, live.get(key), { id: card.dataset.msg, chatId: p.chatId, senderId: p.userId });
  }
}
