import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(path, { method = 'GET', token, key, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function register(phone, email, name) {
  const r = await req('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName: name, password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

test('docs page is served at /api', async () => {
  const res = await fetch(base + '/api');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Ping Developer API/);
});

test('key management requires a session and returns the secret once', async () => {
  const alice = await register('+491700000101', 'a1@example.com', 'Alice');

  // No session token -> 401.
  const anon = await req('/api/dev/keys', { method: 'POST', body: { name: 'x' } });
  assert.equal(anon.status, 401);

  const created = await req('/api/dev/keys', {
    method: 'POST',
    token: alice.token,
    body: { name: 'My bot', scopes: ['profile', 'messages:write'] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const key = created.json.key;
  assert.ok(key.key.startsWith('ping_sk_'), 'secret has the expected prefix');
  assert.deepEqual(key.scopes, ['profile', 'messages:write']);

  // Listing never echoes the secret back.
  const list = await req('/api/dev/keys', { token: alice.token });
  assert.equal(list.status, 200);
  assert.equal(list.json.keys.length, 1);
  assert.equal(list.json.keys[0].key, undefined);
  assert.match(list.json.keys[0].prefix, /^ping_sk_/);
});

test('GET /api/v1/me identifies the key owner', async () => {
  const u = await register('+491700000102', 'a2@example.com', 'Owner');
  const k = await req('/api/dev/keys', { method: 'POST', token: u.token, body: { name: 'k' } });
  const secret = k.json.key.key;

  const me = await req('/api/v1/me', { key: secret });
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.equal(me.json.user.id, u.user.id);
  assert.equal(me.json.user.phone, '+491700000102');
});

test('invalid and missing keys are rejected', async () => {
  const missing = await req('/api/v1/me');
  assert.equal(missing.status, 401);
  const bad = await req('/api/v1/me', { key: 'ping_sk_notarealkey' });
  assert.equal(bad.status, 401);
});

test('scopes are enforced', async () => {
  const u = await register('+491700000103', 'a3@example.com', 'Scoped');
  const bob = await register('+491700000104', 'b3@example.com', 'Bob');
  // Profile-only key.
  const k = await req('/api/dev/keys', {
    method: 'POST',
    token: u.token,
    body: { name: 'readonly', scopes: ['profile'] },
  });
  const secret = k.json.key.key;

  const me = await req('/api/v1/me', { key: secret });
  assert.equal(me.status, 200);

  // Sending needs messages:write -> 403.
  const send = await req('/api/v1/messages', {
    method: 'POST',
    key: secret,
    body: { to: bob.user.phone, body: 'hi' },
  });
  assert.equal(send.status, 403);
});

test('end-to-end: send, list chats, read history', async () => {
  const alice = await register('+491700000105', 'a4@example.com', 'Alice');
  const bob = await register('+491700000106', 'b4@example.com', 'Bob');
  const k = await req('/api/dev/keys', { method: 'POST', token: alice.token, body: { name: 'bot' } });
  const secret = k.json.key.key;

  // Send to bob by phone via the shortcut endpoint.
  const sent = await req('/api/v1/messages', {
    method: 'POST',
    key: secret,
    body: { to: bob.user.phone, body: 'Hello from the API' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  const chatId = sent.json.message.chatId;
  assert.equal(sent.json.message.body, 'Hello from the API');

  // The chat now shows up in alice's list.
  const chats = await req('/api/v1/chats', { key: secret });
  assert.equal(chats.status, 200);
  assert.ok(chats.json.chats.some((c) => c.id === chatId));

  // History contains the message.
  const hist = await req(`/api/v1/chats/${chatId}/messages`, { key: secret });
  assert.equal(hist.status, 200);
  assert.ok(hist.json.messages.some((m) => m.body === 'Hello from the API'));

  // Bob really received it: it lands in his chat history too.
  const bobChats = await req('/api/v1/chats', {
    key: (await req('/api/dev/keys', { method: 'POST', token: bob.token, body: { name: 'b' } })).json
      .key.key,
  });
  assert.ok(bobChats.json.chats.some((c) => c.id === chatId));

  // Sending to a non-existent recipient -> 404.
  const miss = await req('/api/v1/messages', {
    method: 'POST',
    key: secret,
    body: { to: '+490000000000', body: 'nobody' },
  });
  assert.equal(miss.status, 404);
});

test('revoked keys stop working', async () => {
  const u = await register('+491700000107', 'a5@example.com', 'Rev');
  const k = await req('/api/dev/keys', { method: 'POST', token: u.token, body: { name: 'temp' } });
  const secret = k.json.key.key;
  const id = k.json.key.id;

  assert.equal((await req('/api/v1/me', { key: secret })).status, 200);

  const del = await req(`/api/dev/keys/${id}`, { method: 'DELETE', token: u.token });
  assert.equal(del.status, 204);

  assert.equal((await req('/api/v1/me', { key: secret })).status, 401);
});
