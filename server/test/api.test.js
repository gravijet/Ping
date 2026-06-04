import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Use an isolated in-memory-ish db file per run.
process.env.DB_FILE = `:memory:`;
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';

const { createServer } = await import('../src/index.js');

let server;
let base;
let wsBase;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
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
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

async function register(username, password = 'secret1') {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

// Wait for a specific WS event type. Buffers every frame from the moment the
// socket opens so we never miss an event that arrives before we start waiting.
function waitFor(ws, type, timeout = 2000) {
  // Serve from the buffer first.
  const idx = ws._buffer.findIndex((m) => m.type === type);
  if (idx !== -1) return Promise.resolve(ws._buffer.splice(idx, 1)[0].payload);

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeout);
    ws._waiters.push({ type, resolve, reject, timer: t });
  });
}

function connect(token) {
  const ws = new WebSocket(`${wsBase}/ws?token=${token}`);
  ws._buffer = [];
  ws._waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const w = ws._waiters.find((x) => x.type === msg.type);
    if (w) {
      clearTimeout(w.timer);
      ws._waiters.splice(ws._waiters.indexOf(w), 1);
      w.resolve(msg.payload);
    } else {
      ws._buffer.push(msg);
    }
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('register rejects weak input', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { username: 'ab', password: 'x' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Benutzername/);
});

test('duplicate username is rejected', async () => {
  await register('alice');
  const r = await api('/api/auth/register', { method: 'POST', body: { username: 'Alice', password: 'secret1' } });
  assert.equal(r.status, 409);
});

test('login with wrong password fails generically', async () => {
  await register('bob');
  const r = await api('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'nope' } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /stimmt nicht/);
});

test('full direct-message flow with receipts', async () => {
  const carol = await register('carol');
  const dave = await register('dave');

  // Carol searches for Dave and starts a chat.
  const search = await api('/api/users/search?q=dav', { token: carol.token });
  assert.equal(search.json.users.length, 1);
  assert.equal(search.json.users[0].username, 'dave');

  const chatRes = await api('/api/chats/direct', {
    method: 'POST',
    token: carol.token,
    body: { userId: dave.user.id },
  });
  assert.equal(chatRes.status, 201);
  const chatId = chatRes.json.chat.id;

  // Both connect via WebSocket.
  const carolWs = await connect(carol.token);
  const daveWs = await connect(dave.token);
  await waitFor(carolWs, 'ready');
  await waitFor(daveWs, 'ready');

  // Dave should receive the message in real time.
  const incoming = waitFor(daveWs, 'message');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: carol.token,
    body: { body: 'Hallo Dave!' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.message.status, 'sent');

  const got = await incoming;
  assert.equal(got.message.body, 'Hallo Dave!');

  // Dave marks the chat read -> Carol gets a receipt: read.
  const receipt = waitFor(carolWs, 'receipt');
  daveWs.send(JSON.stringify({ type: 'read', payload: { chatId } }));
  const r = await receipt;
  assert.equal(r.status, 'read');

  carolWs.close();
  daveWs.close();
});

test('non-members cannot read a chat', async () => {
  const eve = await register('eve');
  const frank = await register('frank');
  const chat = await api('/api/chats/direct', {
    method: 'POST',
    token: eve.token,
    body: { userId: frank.user.id },
  });
  const mallory = await register('mallory');
  const r = await api(`/api/chats/${chat.json.chat.id}/messages`, { token: mallory.token });
  assert.equal(r.status, 403);
});

test('editing and deleting own messages, but not others', async () => {
  const u1 = await register('grace');
  const u2 = await register('heidi');
  const chat = await api('/api/chats/direct', {
    method: 'POST',
    token: u1.token,
    body: { userId: u2.user.id },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: u1.token,
    body: { body: 'Tippfehlre' },
  });
  const msgId = msg.json.message.id;

  // u2 cannot edit u1's message.
  const forbidden = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH',
    token: u2.token,
    body: { body: 'hacked' },
  });
  assert.equal(forbidden.status, 403);

  // u1 edits it.
  const edited = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH',
    token: u1.token,
    body: { body: 'Tippfehler' },
  });
  assert.equal(edited.json.message.body, 'Tippfehler');
  assert.ok(edited.json.message.editedAt);

  // u1 deletes it.
  const deleted = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'DELETE',
    token: u1.token,
  });
  assert.equal(deleted.json.message.deleted, true);
  assert.equal(deleted.json.message.body, '');
});

test('group chat creation and messaging', async () => {
  const owner = await register('ivan');
  const m1 = await register('judy');
  const group = await api('/api/chats/group', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Team Ping', memberIds: [m1.user.id] },
  });
  assert.equal(group.status, 201);
  assert.equal(group.json.chat.type, 'group');
  assert.equal(group.json.chat.members.length, 2);

  // Judy sees the group in her chat list.
  const judyChats = await api('/api/chats', { token: m1.token });
  assert.ok(judyChats.json.chats.find((c) => c.id === group.json.chat.id));
});

test('unauthorized requests are blocked', async () => {
  const r = await api('/api/chats');
  assert.equal(r.status, 401);
});
