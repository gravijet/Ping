/* e2ee.js — opt-in end-to-end encryption for direct chats (0.34.0, Beta).
   WebCrypto ECDH (P-256) → AES-GCM. The device keeps its private key in
   localStorage and publishes only its public key; the server stores ciphertext +
   public keys and is "blind". A "Sicherheitsnummer" derived from both public keys
   lets two people verify there's no man-in-the-middle.

   Messages are encrypted on send (enc:true, body = ciphertext) when a chat's
   session is active, and decrypted on render. The server never sees plaintext
   (push/search/preview all show a neutral "Verschlüsselte Nachricht"). */

import { api } from './api.js';
import * as store from './store.js';
import { el, icon, modal, toast } from './ui.js';

const LS_PRIV = 'ping.e2ee.priv';   // this device's private key (JWK)
const LS_PUB = 'ping.e2ee.pub';     // this device's public key (raw, base64)
const sessions = new Map();         // chatId -> { enabled, key:CryptoKey|null, peerPub }

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- this device's identity ------------------------------------------------

async function ensureIdentity() {
  if (!subtle()) return null;
  let priv = localStorage.getItem(LS_PRIV);
  let pub = localStorage.getItem(LS_PUB);
  if (priv && pub) {
    // A corrupted stored key must not wedge E2EE forever — fall through and
    // regenerate when the JWK can't be parsed.
    try { return { priv: JSON.parse(priv), pub }; } catch { /* regenerate below */ }
  }
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  const raw = await subtle().exportKey('raw', pair.publicKey);
  priv = JSON.stringify(jwk); pub = b64(raw);
  localStorage.setItem(LS_PRIV, priv);
  localStorage.setItem(LS_PUB, pub);
  return { priv: jwk, pub };
}

async function importPrivate(jwk) {
  return subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}
async function importPublic(rawB64) {
  return subtle().importKey('raw', unb64(rawB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function deriveKey(myJwk, peerPubB64) {
  const myPriv = await importPrivate(myJwk);
  const peerPub = await importPublic(peerPubB64);
  return subtle().deriveKey(
    { name: 'ECDH', public: peerPub }, myPriv,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ---- per-chat session ------------------------------------------------------

/** Load (and cache) the encryption session for a direct [chatId]. */
export async function loadSession(chatId) {
  if (!subtle()) return { enabled: false };
  try {
    const { session, peer } = await api.get(`/chats/${chatId}/e2ee`);
    const me = await ensureIdentity();
    let key = null;
    if (session?.enabled && peer?.publicKey && me) {
      try { key = await deriveKey(me.priv, peer.publicKey); } catch { key = null; }
    }
    const s = { enabled: !!session?.enabled, key, peerPub: peer?.publicKey || null, myPub: me?.pub || null };
    sessions.set(chatId, s);
    return s;
  } catch { return { enabled: false }; }
}

export function isActive(chatId) { return !!sessions.get(chatId)?.enabled && !!sessions.get(chatId)?.key; }

/** Encrypt [text] for [chatId]; returns base64 "iv:ct" or null if not possible. */
export async function encryptFor(chatId, text) {
  const s = sessions.get(chatId);
  if (!s?.key) return null;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, s.key, new TextEncoder().encode(text));
  return `${b64(iv)}:${b64(ct)}`;
}

/** Decrypt message [m]'s ciphertext body for [chatId]; returns text or a marker. */
export async function decrypt(chatId, m) {
  const s = sessions.get(chatId);
  if (!s?.key || !m.body || !m.body.includes(':')) return '🔒 Verschlüsselte Nachricht';
  try {
    const [ivB, ctB] = m.body.split(':');
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(ivB) }, s.key, unb64(ctB));
    return new TextDecoder().decode(pt);
  } catch { return '🔒 Verschlüsselte Nachricht'; }
}

// A short, human-comparable safety number from both public keys.
async function safetyNumber(aPub, bPub) {
  if (!aPub || !bPub || !subtle()) return '— — — — —';
  const joined = [aPub, bPub].sort().join('|');
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(joined));
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < 10; i++) out += String(bytes[i] % 10);
  return out.replace(/(\d{5})(\d{5})/, '$1 $2');
}

// ---- UI --------------------------------------------------------------------

/** The encryption panel for a direct [chatId] (opened from the info panel). */
export async function e2eePanel(chatId) {
  const chat = store.getChat(chatId);
  if (chat?.type !== 'direct') { toast('E2EE gibt es nur in Direktchats.', 'err'); return; }
  const me = await ensureIdentity();
  if (me?.pub) api.put('/me/e2ee/identity', { publicKey: me.pub }).catch(() => {});
  const s = await loadSession(chatId);
  const body = el('div', { class: 'e2ee-panel' });
  const dlg = modal({ title: 'Verschlüsselung (Beta)', width: '440px', body: (b) => b.append(body) });
  paint();
  async function paint() {
    body.replaceChildren(
      el('div', { class: 'e2ee-state' }, [
        icon(s.enabled ? 'lock' : 'unblock'),
        el('span', { text: s.enabled ? 'Ende-zu-Ende verschlüsselt' : 'Nicht verschlüsselt' }),
      ]),
      el('p', { class: 'hint', text: 'Nachrichten werden auf deinem Gerät ver- und entschlüsselt. Der Server speichert nur Chiffretext.' }),
      s.enabled && s.peerPub
        ? el('div', { class: 'e2ee-safety' }, [
            el('div', { class: 'es-label', text: 'Sicherheitsnummer (vergleicht euch)' }),
            el('div', { class: 'es-num', text: await safetyNumber(s.myPub, s.peerPub) }),
          ])
        : null,
      el('button', { class: `btn ${s.enabled ? 'ghost' : 'primary'}`, onClick: toggle },
        s.enabled ? 'Verschlüsselung ausschalten' : 'Verschlüsselung einschalten'),
    );
  }
  async function toggle() {
    try {
      if (!s.enabled && !s.peerPub) {
        toast('Dein Gegenüber muss die App auf 0.34+ aktualisieren, um E2EE zu nutzen.', 'err');
      }
      await api.post(`/chats/${chatId}/e2ee`, { enabled: !s.enabled });
      Object.assign(s, await loadSession(chatId));
      paint();
    } catch (e) { toast(e.message || 'Fehlgeschlagen.', 'err'); }
  }
}

/** Realtime: peer toggled E2EE — refresh our cached session. */
export function onE2ee(chatId) { loadSession(chatId).then(() => store.emit('messages:' + chatId)); }
