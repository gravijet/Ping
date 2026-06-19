import crypto from 'node:crypto';
import { config } from './config.js';

// Web Push (RFC 8030 delivery · RFC 8291 message encryption · RFC 8292 VAPID),
// implemented straight on top of node:crypto with no third-party dependency —
// exactly the way push.js mints FCM OAuth tokens itself rather than pulling in
// the Admin SDK. This is what lets a browser show a notification for a new
// message even when its tab (or the whole browser) is closed.
//
// Two independent key pairs are involved, and they must never be confused:
//   • The VAPID key pair is *stable* and identifies this server to the push
//     service. Its public half is the `applicationServerKey` the browser uses
//     when it subscribes, and it is echoed back in the `Authorization` header.
//   • A fresh *ephemeral* P-256 key pair is generated per message; its public
//     half travels in the aes128gcm header (the "keyid") so the browser can
//     derive the same content-encryption key and decrypt the payload.
//
// If the VAPID keys aren't configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY),
// web push simply stays disabled and every helper no-ops — same contract as FCM.

const P256 = 'prime256v1';

// ---- base64url helpers -----------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(String(str), 'base64url');
}

// Left-pad a big-endian scalar to a fixed width (EC private keys can come back
// a byte or two short when they have leading zero bytes).
function leftPad(buf, len) {
  if (buf.length === len) return buf;
  if (buf.length > len) return buf.subarray(buf.length - len);
  const out = Buffer.alloc(len);
  buf.copy(out, len - buf.length);
  return out;
}

// ---- VAPID keys ------------------------------------------------------------

/**
 * Generate a fresh VAPID key pair (P-256), returned as base64url strings. Run
 * once and store the result in the environment:
 *   node -e "import('./src/webpush.js').then(m=>console.log(m.generateVapidKeys()))"
 */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH(P256);
  const publicKey = ecdh.generateKeys(); // 65-byte uncompressed point (0x04‖X‖Y)
  const privateKey = leftPad(ecdh.getPrivateKey(), 32);
  return { publicKey: b64url(publicKey), privateKey: b64url(privateKey) };
}

const vapid = config.webPush;

export function webPushEnabled() {
  return !!(vapid && vapid.publicKey && vapid.privateKey);
}

/** The applicationServerKey the browser needs to subscribe (base64url, public). */
export function vapidPublicKey() {
  return vapid?.publicKey || '';
}

// Build a signing KeyObject from the raw 32-byte private scalar. We derive the
// public point from the scalar so the JWK is self-consistent regardless of what
// (if anything) was stored as the public key.
let _signKey = null;
function vapidSignKey() {
  if (_signKey) return _signKey;
  const d = leftPad(b64urlDecode(vapid.privateKey), 32);
  const ecdh = crypto.createECDH(P256);
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 0x04‖X‖Y
  _signKey = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64url(d),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
  return _signKey;
}

/**
 * The VAPID `Authorization` header value for a given push endpoint. The signed
 * JWT proves to the push service that this server owns the application key.
 */
export function vapidAuthHeader(endpoint, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(
    JSON.stringify({
      aud,
      // RFC 8292 caps this at 24h; 12h leaves generous clock-skew room.
      exp: nowSec + 12 * 60 * 60,
      sub: vapid.subject,
    })
  );
  const signingInput = `${header}.${claims}`;
  // ES256 signatures must be raw r‖s (IEEE P1363), not the DER node emits by default.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: vapidSignKey(),
    dsaEncoding: 'ieee-p1363',
  });
  const jwt = `${signingInput}.${b64url(signature)}`;
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

// ---- Payload encryption (RFC 8291 + RFC 8188, aes128gcm) -------------------

const KEY_INFO_PREFIX = Buffer.from('WebPush: info\0', 'utf8');
const CEK_INFO = Buffer.from('Content-Encoding: aes128gcm\0', 'utf8');
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0', 'utf8');
const RECORD_SIZE = 4096;

/**
 * Encrypt [plaintext] for a subscription's keys, returning the full aes128gcm
 * body (header ‖ ciphertext). `opts.salt` / `opts.serverPrivateKey` exist purely
 * so tests can pin the otherwise-random inputs and reproduce a known output.
 */
export function encryptPayload(plaintext, keys, opts = {}) {
  const uaPublic = b64urlDecode(keys.p256dh); // 65 bytes
  const authSecret = b64urlDecode(keys.auth); // 16 bytes

  const ecdh = crypto.createECDH(P256);
  let asPublic;
  if (opts.serverPrivateKey) {
    ecdh.setPrivateKey(leftPad(Buffer.from(opts.serverPrivateKey), 32));
    asPublic = ecdh.getPublicKey();
  } else {
    asPublic = ecdh.generateKeys();
  }
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ? Buffer.from(opts.salt) : crypto.randomBytes(16);

  // RFC 8291 §3.4: combine the ECDH secret + auth secret into the input keying
  // material, binding both public keys into the derivation.
  const keyInfo = Buffer.concat([KEY_INFO_PREFIX, uaPublic, asPublic]);
  const ikm = Buffer.from(
    crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32)
  );

  // RFC 8188 §2.2: derive the content-encryption key + nonce from a random salt.
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, CEK_INFO, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, NONCE_INFO, 12));

  // Single record: append the 0x02 "last record" delimiter, then AES-128-GCM.
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])]);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm header: salt(16) ‖ rs(4) ‖ idlen(1) ‖ keyid(asPublic).
  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return Buffer.concat([header, ciphertext]);
}

// ---- Sending ---------------------------------------------------------------

/**
 * Deliver one notification to one subscription. Returns:
 *   { ok }      success (push service accepted it)
 *   { gone }    the subscription is dead (404/410) — caller should delete it
 *   { error }   transient/unknown failure (logged, kept for retry next time)
 */
export async function sendWebPush(sub, payload, { ttl = 2419200, urgency = 'normal' } = {}) {
  if (!webPushEnabled()) return { error: 'disabled' };
  let body;
  try {
    body = encryptPayload(JSON.stringify(payload), { p256dh: sub.p256dh, auth: sub.auth });
  } catch (e) {
    // A malformed/short key can't be encrypted for — treat as dead so it's pruned.
    return { gone: true, reason: e.message };
  }
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        Authorization: vapidAuthHeader(sub.endpoint),
      },
      body,
    });
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 410) return { gone: true };
    console.error('[webpush] push failed:', res.status);
    return { error: res.status };
  } catch (e) {
    console.error('[webpush]', e.message);
    return { error: e.message };
  }
}

/**
 * Fan a notification out to many subscriptions. [onGone] is invoked with each
 * dead subscription's endpoint so the caller can prune it. Returns the number
 * of successful deliveries.
 */
export async function sendWebPushToSubscriptions(subs, payload, onGone) {
  if (!webPushEnabled() || !subs.length) return 0;
  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const r = await sendWebPush(sub, payload);
      if (r.gone && onGone) onGone(sub.endpoint);
      return r.ok ? 1 : 0;
    })
  );
  return results.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value : 0), 0);
}

if (!webPushEnabled()) {
  console.log(
    '[webpush] Web Push deaktiviert (keine VAPID-Schlüssel). ' +
      'Setze VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY, um es zu aktivieren.'
  );
}
