import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = `:memory:`;
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';

const { createServer } = await import('../src/index.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
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

async function register(phone, email) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName: 'Test', password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json; // { token, user }
}

test('desktop link: start -> approve -> poll hands over a working session', async () => {
  const me = await register('+491700000001', 'link1@example.com');

  const start = await api('/api/auth/link/start', { method: 'POST' });
  assert.equal(start.status, 200);
  const { linkId, pollSecret, code } = start.json;
  assert.ok(linkId && pollSecret && code);

  // Before approval the desktop just sees "pending".
  let poll = await api(`/api/auth/link/poll?linkId=${linkId}&secret=${pollSecret}`);
  assert.equal(poll.json.status, 'pending');

  // The signed-in phone approves the scanned code.
  const approve = await api('/api/auth/link/approve', {
    method: 'POST',
    token: me.token,
    body: { code, deviceLabel: 'Windows-PC' },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  // Now the desktop gets a token + the user, and it's the same account.
  poll = await api(`/api/auth/link/poll?linkId=${linkId}&secret=${pollSecret}`);
  assert.equal(poll.json.status, 'approved');
  assert.ok(poll.json.token);
  assert.equal(poll.json.user.id, me.user.id);

  // The handed-over token authenticates as that user.
  const meCheck = await api('/api/me', { token: poll.json.token });
  assert.equal(meCheck.status, 200);
  assert.equal(meCheck.json.user.id, me.user.id);
});

test('desktop link: token is single-use', async () => {
  const me = await register('+491700000002', 'link2@example.com');
  const { linkId, pollSecret, code } = (
    await api('/api/auth/link/start', { method: 'POST' })
  ).json;
  await api('/api/auth/link/approve', {
    method: 'POST',
    token: me.token,
    body: { code },
  });
  const first = await api(`/api/auth/link/poll?linkId=${linkId}&secret=${pollSecret}`);
  assert.equal(first.json.status, 'approved');
  // The link is consumed; a second poll finds nothing.
  const second = await api(`/api/auth/link/poll?linkId=${linkId}&secret=${pollSecret}`);
  assert.equal(second.json.status, 'expired');
});

test('desktop link: wrong pollSecret never leaks the token', async () => {
  const me = await register('+491700000003', 'link3@example.com');
  const { linkId, code } = (await api('/api/auth/link/start', { method: 'POST' }))
    .json;
  await api('/api/auth/link/approve', {
    method: 'POST',
    token: me.token,
    body: { code },
  });
  const poll = await api(`/api/auth/link/poll?linkId=${linkId}&secret=not-the-secret`);
  assert.equal(poll.json.status, 'expired');
  assert.equal(poll.json.token, undefined);
});

test('desktop link: approve requires authentication', async () => {
  const { code } = (await api('/api/auth/link/start', { method: 'POST' })).json;
  const approve = await api('/api/auth/link/approve', {
    method: 'POST',
    body: { code },
  });
  assert.equal(approve.status, 401);
});

test('desktop link: approving an unknown code is rejected', async () => {
  const me = await register('+491700000004', 'link4@example.com');
  const approve = await api('/api/auth/link/approve', {
    method: 'POST',
    token: me.token,
    body: { code: 'totally-made-up-code-value' },
  });
  assert.equal(approve.status, 410);
});
