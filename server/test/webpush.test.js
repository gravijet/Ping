import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Configure VAPID keys BEFORE importing webpush.js, because config.js snapshots
// the environment at import time. We mint a throwaway P-256 pair inline (the
// same shape generateVapidKeys produces) so we don't have to import the module
// we're configuring before it's configured.
const seed = crypto.createECDH('prime256v1');
const seedPub = seed.generateKeys();
process.env.VAPID_PUBLIC_KEY = seedPub.toString('base64url');
process.env.VAPID_PRIVATE_KEY = seed.getPrivateKey().toString('base64url');
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const {
  generateVapidKeys,
  vapidPublicKey,
  webPushEnabled,
  encryptPayload,
  vapidAuthHeader,
} = await import('../src/webpush.js');

// Independent RFC 8291/8188 decryptor — the inverse of encryptPayload, written
// from the spec so a bug in encryption can't be masked by sharing code with it.
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const ecdhSecret = uaEcdh.computeSecret(asPublic);
  const uaPublic = uaEcdh.getPublicKey();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  );

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(enc), decipher.final()]);
  // Strip the 0x02 record delimiter (and any trailing 0x00 padding).
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x00) end--;
  assert.equal(padded[end - 1], 0x02, 'last byte before padding must be the 0x02 delimiter');
  return padded.subarray(0, end - 1).toString('utf8');
}

function fakeSubscription() {
  const ua = crypto.createECDH('prime256v1');
  const p256dh = ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, keys: { p256dh: p256dh.toString('base64url'), auth: auth.toString('base64url') } };
}

test('generateVapidKeys returns a valid base64url P-256 pair', () => {
  const { publicKey, privateKey } = generateVapidKeys();
  const pub = Buffer.from(publicKey, 'base64url');
  const priv = Buffer.from(privateKey, 'base64url');
  assert.equal(pub.length, 65, 'public key is an uncompressed P-256 point');
  assert.equal(pub[0], 0x04, 'uncompressed point marker');
  assert.equal(priv.length, 32, 'private scalar is 32 bytes');
});

test('webPushEnabled is true once VAPID keys are configured', () => {
  assert.equal(webPushEnabled(), true);
  assert.equal(vapidPublicKey(), process.env.VAPID_PUBLIC_KEY);
});

test('encrypt → decrypt round-trips arbitrary payloads (RFC 8291)', () => {
  const sub = fakeSubscription();
  for (const msg of ['', 'hi', JSON.stringify({ title: 'Ping', body: 'Hallo 🌊', data: { chatId: 'abc' } })]) {
    const body = encryptPayload(msg, sub.keys);
    // Header shape: salt(16) ‖ rs(4) ‖ idlen(1) ‖ keyid(65).
    assert.equal(body.readUInt32BE(16), 4096, 'record size');
    assert.equal(body.readUInt8(20), 65, 'keyid length (ephemeral pubkey)');
    assert.equal(decrypt(body, sub.ua, sub.auth), msg);
  }
});

test('encryption is deterministic given a fixed salt + ephemeral key', () => {
  const sub = fakeSubscription();
  const server = crypto.createECDH('prime256v1');
  server.generateKeys();
  const opts = { salt: crypto.randomBytes(16), serverPrivateKey: server.getPrivateKey() };
  const a = encryptPayload('same', sub.keys, opts);
  const b = encryptPayload('same', sub.keys, opts);
  assert.deepEqual(a, b);
  // …and a different salt yields different ciphertext (semantic security).
  const c = encryptPayload('same', sub.keys, { ...opts, salt: crypto.randomBytes(16) });
  assert.notDeepEqual(a, c);
});

test('vapidAuthHeader is a verifiable ES256 JWT bound to the endpoint origin', () => {
  const header = vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123');
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, 'header is "vapid t=<jwt>, k=<key>"');
  const [, jwt, k] = m;
  assert.equal(k, process.env.VAPID_PUBLIC_KEY);

  const [h64, p64, sig64] = jwt.split('.');
  const headerObj = JSON.parse(Buffer.from(h64, 'base64url'));
  const claims = JSON.parse(Buffer.from(p64, 'base64url'));
  assert.equal(headerObj.alg, 'ES256');
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'aud is the endpoint origin');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'not already expired');

  // Verify the signature against the configured public key (raw r‖s / P1363).
  const pub = Buffer.from(process.env.VAPID_PUBLIC_KEY, 'base64url');
  const key = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${h64}.${p64}`),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(sig64, 'base64url')
  );
  assert.equal(ok, true, 'signature verifies');
});
