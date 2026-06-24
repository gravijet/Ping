import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

// VAPID must be configured before config.js/index.js snapshot the environment.
const seed = crypto.createECDH('prime256v1');
process.env.VAPID_PUBLIC_KEY = seed.generateKeys().toString('base64url');
process.env.VAPID_PRIVATE_KEY = seed.getPrivateKey().toString('base64url');

const { createServer } = await import('../src/index.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function register(phone) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email: `${phone}@e.test`, displayName: `U${phone}`, password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.token;
}

function fakeSub(id = 'abc') {
  const ua = crypto.createECDH('prime256v1');
  return {
    endpoint: `https://push.example.com/send/${id}`,
    keys: {
      p256dh: ua.generateKeys().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

test('GET /push/web/vapid exposes the public key when configured', async () => {
  const token = await register('+431000001');
  const r = await api('/api/push/web/vapid', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.enabled, true);
  assert.equal(r.json.publicKey, process.env.VAPID_PUBLIC_KEY);
});

test('vapid endpoint requires auth', async () => {
  const r = await api('/api/push/web/vapid');
  assert.equal(r.status, 401);
});

test('subscribe stores a subscription; unsubscribe removes it; both are idempotent', async () => {
  const token = await register('+431000002');
  const sub = fakeSub('user2');

  // First subscribe + a duplicate (upsert) both succeed.
  assert.equal((await api('/api/push/web/subscribe', { method: 'POST', token, body: sub })).status, 200);
  assert.equal((await api('/api/push/web/subscribe', { method: 'POST', token, body: sub })).status, 200);

  // It is now reachable via the repo for that user.
  const { webSubscriptionsForUsers } = await import('../src/webPushRepo.js');
  const { getUserByPhone } = await import('../src/repo.js');
  const uid = getUserByPhone('+431000002').id;
  assert.equal(webSubscriptionsForUsers([uid]).length, 1);

  // Unsubscribe is scoped + idempotent.
  assert.equal(
    (await api('/api/push/web/unsubscribe', { method: 'POST', token, body: { endpoint: sub.endpoint } })).status,
    200
  );
  assert.equal(webSubscriptionsForUsers([uid]).length, 0);
  assert.equal(
    (await api('/api/push/web/unsubscribe', { method: 'POST', token, body: { endpoint: sub.endpoint } })).status,
    200
  );
});

test('subscribe rejects a malformed subscription', async () => {
  const token = await register('+431000003');
  const r = await api('/api/push/web/subscribe', {
    method: 'POST',
    token,
    body: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
  });
  assert.equal(r.status, 400);
});

test('subscribe blocks an SSRF endpoint (private/metadata/loopback host)', async () => {
  const token = await register('+431000006');
  const { webSubscriptionsForUsers } = await import('../src/webPushRepo.js');
  const { getUserByPhone } = await import('../src/repo.js');
  const uid = getUserByPhone('+431000006').id;
  for (const endpoint of [
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://localhost/internal',
    'http://127.0.0.1/internal',
    'http://10.0.0.5/x',
    'http://[::1]/x',
    'ftp://example.com/x', // non-http scheme
  ]) {
    const r = await api('/api/push/web/subscribe', {
      method: 'POST',
      token,
      body: { endpoint, keys: { p256dh: 'x', auth: 'y' } },
    });
    assert.equal(r.status, 400, `must reject ${endpoint}`);
  }
  // None of the malicious endpoints were stored.
  assert.equal(webSubscriptionsForUsers([uid]).length, 0);
});

test("a user cannot remove another user's subscription", async () => {
  const a = await register('+431000004');
  const b = await register('+431000005');
  const sub = fakeSub('user4');
  await api('/api/push/web/subscribe', { method: 'POST', token: a, body: sub });

  const { webSubscriptionsForUsers } = await import('../src/webPushRepo.js');
  const { getUserByPhone } = await import('../src/repo.js');
  const aid = getUserByPhone('+431000004').id;

  // b tries to unsubscribe a's endpoint — scoped delete leaves it intact.
  await api('/api/push/web/unsubscribe', { method: 'POST', token: b, body: { endpoint: sub.endpoint } });
  assert.equal(webSubscriptionsForUsers([aid]).length, 1);
});
