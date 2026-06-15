import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.DB_FILE = `:memory:`;
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { createScheduled } = await import('../src/scheduledRepo.js');
const { runMaintenance } = await import('../src/maintenance.js');

const ADMIN = 'test-admin-token';
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

async function api(path, { method = 'GET', token, admin, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(admin ? { 'x-admin-token': admin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

async function register(phone, email, displayName, password = 'secret1') {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName, password },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json; // { token, user (private) }
}

function waitFor(ws, type, timeout = 2000) {
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

test('register requires phone, email, password and name', async () => {
  const weak = await api('/api/auth/register', {
    method: 'POST',
    body: { phone: '0170 1', email: 'x', password: 'x', displayName: '' },
  });
  assert.equal(weak.status, 400);

  const ok = await register('0170 1111111', 'anna@example.com', 'Anna');
  assert.equal(ok.user.phone, '+431701111111');
  assert.equal(ok.user.email, 'anna@example.com');
  assert.ok(ok.token);
});

test('duplicate phone or email is rejected', async () => {
  await register('+431702222222', 'dup@example.com', 'First');
  // Same number, national notation -> normalises to the same +43… -> conflict.
  const dupPhone = await api('/api/auth/register', {
    method: 'POST',
    body: { phone: '0170 2222222', email: 'other@example.com', password: 'secret1', displayName: 'X' },
  });
  assert.equal(dupPhone.status, 409);
  const dupEmail = await api('/api/auth/register', {
    method: 'POST',
    body: { phone: '+491709999999', email: 'DUP@example.com', password: 'secret1', displayName: 'X' },
  });
  assert.equal(dupEmail.status, 409);
});

test('login by email and by phone, wrong password fails', async () => {
  await register('+431703333333', 'login@example.com', 'Lo', 'hunter2');
  const byEmail = await api('/api/auth/login', {
    method: 'POST',
    body: { login: 'login@example.com', password: 'hunter2' },
  });
  assert.equal(byEmail.status, 200);
  const byPhone = await api('/api/auth/login', {
    method: 'POST',
    body: { login: '0170 3333333', password: 'hunter2' },
  });
  assert.equal(byPhone.status, 200);
  const bad = await api('/api/auth/login', {
    method: 'POST',
    body: { login: 'login@example.com', password: 'nope' },
  });
  assert.equal(bad.status, 401);
});

test('public views never leak phone or email; lookup is phone-only', async () => {
  const a = await register('+491700000001', 'a@example.com', 'Alice');
  const b = await register('+491700000002', 'b@example.com', 'Bob');
  const look = await api('/api/users/lookup', {
    method: 'POST',
    token: a.token,
    body: { phone: b.user.phone },
  });
  assert.equal(look.status, 200);
  assert.equal(look.json.user.displayName, 'Bob');
  assert.equal(look.json.user.phone, undefined);
  assert.equal(look.json.user.email, undefined);

  // Email is no longer a discovery key — lookup by email is rejected.
  const byEmail = await api('/api/users/lookup', {
    method: 'POST',
    token: a.token,
    body: { email: 'b@example.com' },
  });
  assert.equal(byEmail.status, 400);
});

test('contact match returns only registered contacts and echoes identifiers', async () => {
  const me = await register('+491700000010', 'me@example.com', 'Me');
  const friend = await register('+431700000011', 'friend@example.com', 'Friend');

  const r = await api('/api/contacts/match', {
    method: 'POST',
    token: me.token,
    body: {
      // friend + a stranger + myself (self must be excluded from results)
      phones: ['0170 0000011', '+491700000999', '+491700000010'],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.users.length, 1);
  assert.equal(r.json.users[0].user.id, friend.user.id);
  assert.equal(r.json.users[0].phone, '+431700000011');
});

test('start a direct chat by phone or user id', async () => {
  const a = await register('+491700000020', 'a20@example.com', 'A20');
  const b = await register('+431700000021', 'b21@example.com', 'B21');

  const byPhone = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0170 0000021' },
  });
  assert.equal(byPhone.status, 201);

  // Same pair via user id resolves to the same chat.
  const byId = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { userId: b.user.id },
  });
  assert.equal(byId.json.chat.id, byPhone.json.chat.id);

  // Email is no longer accepted as a way to start a chat.
  const byEmail = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { email: 'b21@example.com' },
  });
  assert.equal(byEmail.status, 400);

  const unknown = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '+491700088888' },
  });
  assert.equal(unknown.status, 404);
});

test('full direct-message flow with receipts', async () => {
  const carol = await register('+491700000030', 'carol@example.com', 'Carol');
  const dave = await register('+491700000031', 'dave@example.com', 'Dave');
  const chatRes = await api('/api/chats/direct', {
    method: 'POST', token: carol.token, body: { phone: dave.user.phone },
  });
  const chatId = chatRes.json.chat.id;

  const carolWs = await connect(carol.token);
  const daveWs = await connect(dave.token);
  await waitFor(carolWs, 'ready');
  await waitFor(daveWs, 'ready');

  const incoming = waitFor(daveWs, 'message');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: carol.token, body: { body: 'Hallo Dave!' },
  });
  assert.equal(sent.json.message.status, 'sent');
  const got = await incoming;
  assert.equal(got.message.body, 'Hallo Dave!');

  const receipt = waitFor(carolWs, 'receipt');
  daveWs.send(JSON.stringify({ type: 'read', payload: { chatId } }));
  assert.equal((await receipt).status, 'read');

  carolWs.close();
  daveWs.close();
});

test('non-members cannot read a chat', async () => {
  const eve = await register('+491700000040', 'eve@example.com', 'Eve');
  const frank = await register('+491700000041', 'frank@example.com', 'Frank');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: eve.token, body: { phone: frank.user.phone },
  });
  const mallory = await register('+491700000042', 'mallory@example.com', 'Mallory');
  const r = await api(`/api/chats/${chat.json.chat.id}/messages`, { token: mallory.token });
  assert.equal(r.status, 403);
});

test('editing and deleting own messages, but not others', async () => {
  const u1 = await register('+491700000050', 'grace@example.com', 'Grace');
  const u2 = await register('+491700000051', 'heidi@example.com', 'Heidi');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: u1.token, body: { phone: u2.user.phone },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: u1.token, body: { body: 'Tippfehlre' },
  });
  const msgId = msg.json.message.id;

  const forbidden = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: u2.token, body: { body: 'hacked' },
  });
  assert.equal(forbidden.status, 403);

  const edited = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: u1.token, body: { body: 'Tippfehler' },
  });
  assert.equal(edited.json.message.body, 'Tippfehler');

  const deleted = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'DELETE', token: u1.token,
  });
  assert.equal(deleted.json.message.deleted, true);
});

test('group chat creation, messaging and adding members', async () => {
  const owner = await register('+491700000060', 'ivan@example.com', 'Ivan');
  const judy = await register('+491700000061', 'judy@example.com', 'Judy');
  const group = await api('/api/chats/group', {
    method: 'POST', token: owner.token,
    body: { name: 'Team Ping', memberIds: [judy.user.id] },
  });
  assert.equal(group.status, 201);
  assert.equal(group.json.chat.members.length, 2);

  const mona = await register('+491700000062', 'mona@example.com', 'Mona');
  const add = await api(`/api/chats/${group.json.chat.id}/members`, {
    method: 'POST', token: owner.token, body: { memberIds: [mona.user.id] },
  });
  assert.equal(add.json.added.length, 1);
  const monaChats = await api('/api/chats', { token: mona.token });
  assert.ok(monaChats.json.chats.find((c) => c.id === group.json.chat.id));
});

test('profile picture upload, fetch and delete', async () => {
  const u = await register('+491700000070', 'pia@example.com', 'Pia');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fetch(base + '/api/me/avatar', {
    method: 'POST',
    headers: { authorization: `Bearer ${u.token}`, 'content-type': 'image/png' },
    body: png,
  });
  const upJson = await up.json();
  assert.equal(up.status, 200, JSON.stringify(upJson));
  assert.equal(upJson.user.hasAvatar, true);

  const img = await fetch(base + `/api/users/${u.user.id}/avatar`, {
    headers: { authorization: `Bearer ${u.token}` },
  });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const del = await api('/api/me/avatar', { method: 'DELETE', token: u.token });
  assert.equal(del.json.user.hasAvatar, false);
});

test('changing the password requires the current one', async () => {
  const u = await register('+491700000080', 'pat@example.com', 'Pat', 'oldpass1');
  const noCurrent = await api('/api/me/security', {
    method: 'PATCH', token: u.token, body: { password: 'newpass1' },
  });
  assert.equal(noCurrent.status, 403);
  const ok = await api('/api/me/security', {
    method: 'PATCH', token: u.token,
    body: { password: 'newpass1', currentPassword: 'oldpass1' },
  });
  assert.equal(ok.status, 200);
  const login = await api('/api/auth/login', {
    method: 'POST', body: { login: 'pat@example.com', password: 'newpass1' },
  });
  assert.equal(login.status, 200);
});

test('a reply carries an inline quoted snapshot of the original', async () => {
  const a = await register('+491700000100', 'quote-a@example.com', 'QuoteA');
  const b = await register('+491700000101', 'quote-b@example.com', 'QuoteB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  const first = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Die Originalnachricht' },
  });
  const reply = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token,
    body: { body: 'Antwort darauf', replyTo: first.json.message.id },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.json.message.replyTo, first.json.message.id);
  assert.ok(reply.json.message.quoted, 'expected an inline quoted snapshot');
  assert.equal(reply.json.message.quoted.id, first.json.message.id);
  assert.equal(reply.json.message.quoted.senderId, a.user.id);
  assert.equal(reply.json.message.quoted.body, 'Die Originalnachricht');

  // The snapshot is still there when the reply comes back via history…
  const history = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const fetched = history.json.messages.find((m) => m.id === reply.json.message.id);
  assert.equal(fetched.quoted.body, 'Die Originalnachricht');

  // …and a deleted original shows up as an empty, flagged snapshot.
  await api(`/api/chats/${chatId}/messages/${first.json.message.id}`, {
    method: 'DELETE', token: a.token,
  });
  const after = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const replyAfter = after.json.messages.find((m) => m.id === reply.json.message.id);
  assert.equal(replyAfter.quoted.deleted, true);
  assert.equal(replyAfter.quoted.body, '');
});

test('a user can delete their own account with their password', async () => {
  const u = await register('+491700000120', 'gone@example.com', 'Gonna', 'leavnow1');

  const noPw = await api('/api/me', { method: 'DELETE', token: u.token });
  assert.equal(noPw.status, 403);
  const wrongPw = await api('/api/me', {
    method: 'DELETE', token: u.token, body: { password: 'nope' },
  });
  assert.equal(wrongPw.status, 403);

  const del = await api('/api/me', {
    method: 'DELETE', token: u.token, body: { password: 'leavnow1' },
  });
  assert.equal(del.status, 204);

  // The account is gone: the old token no longer resolves and re-login fails.
  const me = await api('/api/me', { token: u.token });
  assert.equal(me.status, 401);
  const login = await api('/api/auth/login', {
    method: 'POST', body: { login: 'gone@example.com', password: 'leavnow1' },
  });
  assert.equal(login.status, 401);
});

test('deleting an account keeps the conversation but anonymises the sender', async () => {
  const a = await register('+491700000130', 'leaver@example.com', 'Leaver', 'byebye12');
  const b = await register('+491700000131', 'stayer@example.com', 'Stayer');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Bis bald!' },
  });

  const del = await api('/api/me', {
    method: 'DELETE', token: a.token, body: { password: 'byebye12' },
  });
  assert.equal(del.status, 204);

  const history = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const msg = history.json.messages.find((m) => m.body === 'Bis bald!');
  assert.ok(msg, 'the message should still be there for the other person');
  assert.equal(msg.senderId, null);
});

test('admin stats report user and live-connection counts', async () => {
  const u = await register('+491700000140', 'stat@example.com', 'Statler');
  const before = await api('/api/admin/stats', { admin: ADMIN });
  assert.equal(before.status, 200);
  assert.equal(typeof before.json.users, 'number');
  assert.equal(typeof before.json.online, 'number');

  const ws = await connect(u.token);
  await waitFor(ws, 'ready');
  const during = await api('/api/admin/stats', { admin: ADMIN });
  assert.equal(during.json.online, before.json.online + 1);
  ws.close();
});

test('admin endpoints are gated by the admin token', async () => {
  const noToken = await api('/api/admin/users');
  assert.equal(noToken.status, 401);
  const wrong = await api('/api/admin/users', { admin: 'nope' });
  assert.equal(wrong.status, 401);
  const ok = await api('/api/admin/users', { admin: ADMIN });
  assert.equal(ok.status, 200);
});

test('admin can create, search, promote, reset and delete users', async () => {
  const created = await api('/api/admin/users', {
    method: 'POST', admin: ADMIN,
    body: { phone: '+491700000090', email: 'created@example.com', password: 'secret9', displayName: 'Created' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.email, 'created@example.com');
  const id = created.json.user.id;

  const found = await api('/api/admin/users?q=created@example.com', { admin: ADMIN });
  assert.ok(found.json.users.find((u) => u.id === id));

  const promote = await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { isAdmin: true },
  });
  assert.equal(promote.json.user.isAdmin, true);

  const reset = await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { password: 'brandnew1' },
  });
  assert.equal(reset.status, 200);
  const login = await api('/api/auth/login', {
    method: 'POST', body: { login: 'created@example.com', password: 'brandnew1' },
  });
  assert.equal(login.status, 200);

  const del = await api(`/api/admin/users/${id}`, { method: 'DELETE', admin: ADMIN });
  assert.equal(del.status, 204);
  const gone = await api('/api/admin/users?q=created@example.com', { admin: ADMIN });
  assert.equal(gone.json.users.find((u) => u.id === id), undefined);
});

test('the admin portal page is served', async () => {
  const res = await fetch(base + '/admin');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Ping · Admin/);
});

test('unauthorized requests are blocked', async () => {
  const r = await api('/api/chats');
  assert.equal(r.status, 401);
});

test('upload an attachment and send it as an image message', async () => {
  const a = await register('+491700000200', 'media-a@example.com', 'MediaA');
  const b = await register('+491700000201', 'media-b@example.com', 'MediaB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a.token}`,
      'content-type': 'image/png',
      'x-filename': 'foto.png',
    },
    body: png,
  });
  const upJson = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upJson));
  assert.match(upJson.upload.url, /^\/api\/uploads\//);
  assert.equal(upJson.upload.kind, 'image');

  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token,
    body: {
      type: 'image',
      attachment: { url: upJson.upload.url, mime: 'image/png', name: 'foto.png' },
    },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.message.type, 'image');
  assert.equal(sent.json.message.attachment.url, upJson.upload.url);

  const dl = await fetch(base + upJson.upload.url, {
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'image/png');
});

test('attachments must reference our own upload urls', async () => {
  const a = await register('+491700000210', 'evil@example.com', 'Evil');
  const b = await register('+491700000211', 'victim@example.com', 'Victim');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const bad = await api(`/api/chats/${chat.json.chat.id}/messages`, {
    method: 'POST', token: a.token,
    body: { type: 'image', attachment: { url: 'https://evil.example/x.png' } },
  });
  assert.equal(bad.status, 400);
});

test('status: post, peers see it, view it and list viewers', async () => {
  const a = await register('+491700000220', 'st-a@example.com', 'StA');
  const b = await register('+491700000221', 'st-b@example.com', 'StB');
  await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });

  const created = await api('/api/status', {
    method: 'POST', token: a.token,
    body: { type: 'text', body: 'Hallo Welt', bgColor: '#0A84FF' },
  });
  assert.equal(created.status, 201);
  const statusId = created.json.status.id;

  const mine = await api('/api/status', { token: a.token });
  assert.equal(mine.json.mine.length, 1);

  const bSees = await api('/api/status', { token: b.token });
  const group = bSees.json.others.find((o) => o.user.id === a.user.id);
  assert.ok(group, "B should see A's status");
  assert.equal(group.hasUnseen, true);

  await api(`/api/status/${statusId}/view`, { method: 'POST', token: b.token });
  const viewers = await api(`/api/status/${statusId}/viewers`, { token: a.token });
  assert.equal(viewers.json.viewers.length, 1);
  assert.equal(viewers.json.viewers[0].user.id, b.user.id);

  const forbidden = await api(`/api/status/${statusId}/viewers`, { token: b.token });
  assert.equal(forbidden.status, 403);

  const del = await api(`/api/status/${statusId}`, { method: 'DELETE', token: a.token });
  assert.equal(del.status, 204);
});

test('blocking prevents the blocked user from messaging', async () => {
  const a = await register('+491700000230', 'blk-a@example.com', 'BlkA');
  const b = await register('+491700000231', 'blk-b@example.com', 'BlkB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;

  const block = await api(`/api/users/${b.user.id}/block`, {
    method: 'POST', token: a.token,
  });
  assert.equal(block.status, 200);
  const list = await api('/api/blocks', { token: a.token });
  assert.ok(list.json.blocked.includes(b.user.id));

  const blocked = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token, body: { body: 'Hallo?' },
  });
  assert.equal(blocked.status, 403);

  // Blocking cuts the line in both directions: the blocker can't write either.
  const blockerToo = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Du bist blockiert' },
  });
  assert.equal(blockerToo.status, 403);
  assert.match(blockerToo.json.error, /blockiert/i);

  await api(`/api/users/${b.user.id}/unblock`, { method: 'POST', token: a.token });
  const after = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token, body: { body: 'Wieder da' },
  });
  assert.equal(after.status, 201);
  const fromBlocker = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Alles gut' },
  });
  assert.equal(fromBlocker.status, 201);
});

test('a signed-in admin user can use the admin API without the token', async () => {
  const u = await register('+491700000240', 'adminuser@example.com', 'AdminUser');
  const denied = await api('/api/admin/stats', { token: u.token });
  assert.equal(denied.status, 401);

  await api(`/api/admin/users/${u.user.id}`, {
    method: 'PATCH', admin: ADMIN, body: { isAdmin: true },
  });
  const ok = await api('/api/admin/stats', { token: u.token });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.json.messages, 'number');

  const bc = await api('/api/admin/broadcast', {
    method: 'POST', token: u.token,
    body: { title: 'Hinweis', body: 'Wartung um 22 Uhr' },
  });
  assert.equal(bc.status, 200);
  assert.equal(typeof bc.json.delivered, 'number');
});

test('the /api/console bridge reaches the admin API for the native app', async () => {
  // The native app can't carry a Cloudflare Access session, so it talks to the
  // admin handlers through /api/console/* instead. It must behave exactly like
  // /api/admin/*: still admin-gated, just reachable without the CF Access login.
  const u = await register('+491700000241', 'consoleadmin@example.com', 'ConsoleAdmin');

  // A non-admin signed-in user is rejected, same as on /api/admin.
  const denied = await api('/api/console/stats', { token: u.token });
  assert.equal(denied.status, 401);

  // Unauthenticated traffic is rejected too.
  const anon = await api('/api/console/stats');
  assert.equal(anon.status, 401);

  await api(`/api/admin/users/${u.user.id}`, {
    method: 'PATCH', admin: ADMIN, body: { isAdmin: true },
  });

  // Now the same admin reaches stats through the bridge.
  const ok = await api('/api/console/stats', { token: u.token });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.json.messages, 'number');

  // The shared admin token works through the bridge as well.
  const withToken = await api('/api/console/users', { admin: ADMIN });
  assert.equal(withToken.status, 200);
  assert.ok(Array.isArray(withToken.json.users));
});

test('group owner can rename, set a picture and remove members; others cannot', async () => {
  const owner = await register('+431700000300', 'gowner@example.com', 'GOwner');
  const m1 = await register('+431700000301', 'gm1@example.com', 'GM1');
  const m2 = await register('+431700000302', 'gm2@example.com', 'GM2');

  const created = await api('/api/chats/group', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Crew', memberIds: [m1.user.id, m2.user.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const chatId = created.json.chat.id;

  // Owner renames + describes the group.
  const renamed = await api(`/api/chats/${chatId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { name: 'Best Crew', description: 'Unsere Gruppe' },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.chat.title, 'Best Crew');
  assert.equal(renamed.json.chat.description, 'Unsere Gruppe');

  // A non-owner member may not edit.
  const forbidden = await api(`/api/chats/${chatId}`, {
    method: 'PATCH',
    token: m1.token,
    body: { name: 'Hijack' },
  });
  assert.equal(forbidden.status, 403);

  // Owner sets a group picture (valid PNG header).
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fetch(base + `/api/chats/${chatId}/avatar`, {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      authorization: `Bearer ${owner.token}`,
    },
    body: png,
  });
  assert.equal(up.status, 200);
  const upJson = await up.json();
  assert.equal(upJson.chat.hasAvatar, true);

  // The picture is served back to a member.
  const pic = await fetch(base + `/api/chats/${chatId}/avatar`, {
    headers: { authorization: `Bearer ${m1.token}` },
  });
  assert.equal(pic.status, 200);

  // Owner removes m2; m2 disappears from the member list.
  const removed = await api(`/api/chats/${chatId}/members/${m2.user.id}`, {
    method: 'DELETE',
    token: owner.token,
  });
  assert.equal(removed.status, 200);
  const afterRemove = await api(`/api/chats/${chatId}`, { token: owner.token });
  assert.ok(!afterRemove.json.chat.memberIds.includes(m2.user.id));

  // A non-owner cannot remove members.
  const cantRemove = await api(`/api/chats/${chatId}/members/${m1.user.id}`, {
    method: 'DELETE',
    token: m1.token,
  });
  assert.equal(cantRemove.status, 403);
});

test('push tokens register and unregister; auth required', async () => {
  const u = await register('+491700000990', 'push@example.com', 'Push User');

  // Needs auth.
  const noAuth = await api('/api/push/token', {
    method: 'POST',
    body: { token: 'tok-abc', platform: 'android' },
  });
  assert.equal(noAuth.status, 401);

  // Register a token (push may be disabled server-side; this just stores it).
  const reg = await api('/api/push/token', {
    method: 'POST',
    token: u.token,
    body: { token: 'tok-abc', platform: 'android' },
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.ok, true);

  // A bad payload is rejected.
  const bad = await api('/api/push/token', {
    method: 'POST',
    token: u.token,
    body: { platform: 'android' },
  });
  assert.equal(bad.status, 400);

  // Unregister.
  const del = await api('/api/push/token', {
    method: 'DELETE',
    token: u.token,
    body: { token: 'tok-abc' },
  });
  assert.equal(del.status, 200);
});

test('personal data export returns account + chats', async () => {
  const a = await register('+491700000700', 'exp-a@example.com', 'Exp A');
  const b = await register('+491700000701', 'exp-b@example.com', 'Exp B');
  const chat = await api('/api/chats/direct', {
    method: 'POST',
    token: a.token,
    body: { userId: b.user.id },
  });
  await api(`/api/chats/${chat.json.chat.id}/messages`, {
    method: 'POST',
    token: a.token,
    body: { body: 'hallo export' },
  });

  const noAuth = await api('/api/me/export');
  assert.equal(noAuth.status, 401);

  const exp = await api('/api/me/export', { token: a.token });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.account.id, a.user.id);
  assert.ok(Array.isArray(exp.json.chats));
  const exported = exp.json.chats.find((c) => c.chat.id === chat.json.chat.id);
  assert.ok(exported, 'the chat should be in the export');
  assert.ok(exported.messages.some((m) => m.body === 'hallo export'));
});

test('local storage mode purges a sent message after all recipients read it', async () => {
  const a = await register('+491700000800', 'store-a@example.com', 'Store A');
  const b = await register('+491700000801', 'store-b@example.com', 'Store B');

  const mode = await api('/api/me/message-storage', {
    method: 'POST',
    token: a.token,
    body: { mode: 'local' },
  });
  assert.equal(mode.status, 200);
  assert.equal(mode.json.user.messageStorage, 'local');

  const chat = await api('/api/chats/direct', {
    method: 'POST',
    token: a.token,
    body: { userId: b.user.id },
  });
  const chatId = chat.json.chat.id;

  const bWs = await connect(b.token);
  await waitFor(bWs, 'ready');

  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { body: 'vergänglich' },
  });
  const msgId = sent.json.message.id;

  // B reads the chat → the message is now read by everyone → server purges it.
  bWs.send(JSON.stringify({ type: 'read', payload: { chatId } }));
  await new Promise((r) => setTimeout(r, 250));

  const hist = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  assert.ok(
    !hist.json.messages.some((m) => m.id === msgId),
    'the message should be gone from the server'
  );
  bWs.close();
});

test('admin can list and trigger DB backups', async () => {
  const list = await api('/api/admin/backups', { admin: ADMIN });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.backups));

  const made = await api('/api/admin/backups', {
    method: 'POST',
    admin: ADMIN,
  });
  assert.equal(made.status, 200);
  assert.equal(made.json.ok, true);
});

test('admin can download a backup, and bad/traversal names are rejected', async () => {
  // Make sure at least one snapshot exists.
  await api('/api/admin/backups', { method: 'POST', admin: ADMIN });
  const list = await api('/api/admin/backups', { admin: ADMIN });
  assert.ok(list.json.backups.length > 0, 'expected at least one backup');
  const name = list.json.backups[0].name;

  // Download is binary, so fetch directly rather than via the JSON helper.
  const dl = await fetch(base + '/api/admin/backups/' + encodeURIComponent(name), {
    headers: { 'x-admin-token': ADMIN },
  });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  const buf = await dl.arrayBuffer();
  assert.ok(buf.byteLength > 0, 'downloaded backup should not be empty');

  // Without the admin token it's rejected.
  const noAuth = await fetch(base + '/api/admin/backups/' + encodeURIComponent(name));
  assert.equal(noAuth.status, 401);

  // Only the exact ping-YYYYMMDD-HHMM.db shape is served; everything else 404s
  // (this also blocks path traversal).
  for (const bad of ['evil.txt', 'ping-2026.db', '..%2f..%2fping.db', name + '.bak']) {
    const r = await fetch(base + '/api/admin/backups/' + bad, {
      headers: { 'x-admin-token': ADMIN },
    });
    assert.equal(r.status, 404, `expected 404 for ${bad} (got ${r.status})`);
  }
});

test('cloudflare access gate blocks admin when configured without a valid assertion', async () => {
  const saved = config.cfAccess;
  config.cfAccess = { teamDomain: 'example.cloudflareaccess.com', aud: 'test-aud' };
  try {
    // No Cf-Access-Jwt-Assertion header → rejected before requireAdmin.
    const blocked = await fetch(base + '/api/admin/backups', {
      headers: { 'x-admin-token': ADMIN },
    });
    assert.equal(blocked.status, 403);
  } finally {
    config.cfAccess = saved; // restore the no-op state
  }
  // With the feature off again, admin works as before.
  const ok = await api('/api/admin/backups', { admin: ADMIN });
  assert.equal(ok.status, 200);
});

test('SMS OTP: request a code, verify it, and register with the token', async () => {
  const phone = '+436601234567';
  const req = await api('/api/auth/request-code', {
    method: 'POST',
    body: { phone },
  });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  assert.ok(req.json.devCode, 'log provider should expose the code for testing');

  // A wrong code is rejected.
  const bad = await api('/api/auth/verify-code', {
    method: 'POST',
    body: { phone, code: '000000' },
  });
  assert.equal(bad.status, 400);

  // The real code yields a verify token.
  const ok = await api('/api/auth/verify-code', {
    method: 'POST',
    body: { phone, code: req.json.devCode },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.verifyToken);

  // Registering with the token succeeds and the number matches.
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      phone,
      email: 'otp@example.com',
      displayName: 'Otto',
      password: 'secret1',
      verifyToken: ok.json.verifyToken,
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(reg.json.user.phone, phone);
});

test('SMS OTP: resend is throttled', async () => {
  const phone = '+436609998877';
  const first = await api('/api/auth/request-code', { method: 'POST', body: { phone } });
  assert.equal(first.status, 200);
  const again = await api('/api/auth/request-code', { method: 'POST', body: { phone } });
  assert.equal(again.status, 429);
  assert.ok(again.json.retryInSec >= 0);
});

test('admin overview returns stats, charts and system health', async () => {
  const r = await api('/api/admin/overview', { admin: ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(typeof r.json.stats.users === 'number');
  assert.ok(Array.isArray(r.json.charts.usersPerDay));
  assert.equal(r.json.charts.usersPerDay.length, 7);
  assert.ok(r.json.system.node.startsWith('v'));
  assert.ok(typeof r.json.system.uptimeSec === 'number');
});

test('admin can list chats and delete one', async () => {
  const a = await register('0680 1000001', 'chatadm-a@example.com', 'CA');
  const b = await register('0680 1000002', 'chatadm-b@example.com', 'CB');
  const lookup = await api('/api/users/lookup', {
    method: 'POST',
    token: a.token,
    body: { phone: '0680 1000002' },
  });
  const chat = await api('/api/chats/direct', {
    method: 'POST',
    token: a.token,
    body: { userId: lookup.json.user.id },
  });
  const chatId = chat.json.chat.id;

  const list = await api('/api/admin/chats', { admin: ADMIN });
  assert.equal(list.status, 200);
  assert.ok(list.json.chats.some((c) => c.id === chatId));

  const del = await api(`/api/admin/chats/${chatId}`, { method: 'DELETE', admin: ADMIN });
  assert.equal(del.status, 204);

  const list2 = await api('/api/admin/chats', { admin: ADMIN });
  assert.ok(!list2.json.chats.some((c) => c.id === chatId));
});

test('admin broadcast is recorded in history', async () => {
  const sent = await api('/api/admin/broadcast', {
    method: 'POST',
    admin: ADMIN,
    body: { title: 'Hallo', body: 'Test-Durchsage' },
  });
  assert.equal(sent.status, 200);
  const hist = await api('/api/admin/broadcasts', { admin: ADMIN });
  assert.equal(hist.status, 200);
  assert.ok(hist.json.broadcasts.some((b) => b.body === 'Test-Durchsage'));
});

test('admin actions are written to the audit log', async () => {
  // A broadcast is an auditable action.
  await api('/api/admin/broadcast', {
    method: 'POST',
    admin: ADMIN,
    body: { title: 'Audit', body: 'Eintrag erzeugen' },
  });
  const log = await api('/api/admin/audit', { admin: ADMIN });
  assert.equal(log.status, 200);
  assert.ok(Array.isArray(log.json.entries));
  assert.ok(log.json.entries.some((e) => e.action === 'broadcast.send'));

  // Filtering narrows the result set.
  const filtered = await api('/api/admin/audit?q=broadcast.send', { admin: ADMIN });
  assert.ok(filtered.json.entries.every((e) => /broadcast\.send/.test(e.action)));

  // The endpoint is admin-gated.
  const noAuth = await api('/api/admin/audit');
  assert.equal(noAuth.status, 401);
});

test('admin overview accepts a 7/14/30-day range', async () => {
  const r = await api('/api/admin/overview?days=30', { admin: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.json.range.days, 30);
  assert.equal(r.json.charts.usersPerDay.length, 30);
  // Out-of-range values clamp into [7, 30].
  const clamped = await api('/api/admin/overview?days=999', { admin: ADMIN });
  assert.equal(clamped.json.range.days, 30);
});

test('landing page and APK download endpoints respond', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('Ping'));

  const info = await fetch(base + '/download/info');
  // 200 with metadata when a build is published, 404 otherwise — both are valid.
  assert.ok(info.status === 200 || info.status === 404);
});

test('admin can disable a user, blocking login and existing sessions', async () => {
  const u = await register('0681 2000003', 'ban-me@example.com', 'Banned');
  // Token works before the ban.
  const okBefore = await api('/api/me', { token: u.token });
  assert.equal(okBefore.status, 200);

  // Find + disable.
  const list = await api('/api/admin/users?q=ban-me@example.com', { admin: ADMIN });
  const id = list.json.users.find((x) => x.email === 'ban-me@example.com').id;
  const dis = await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { disabled: true },
  });
  assert.equal(dis.json.user.disabled, true);

  // Existing token is now rejected, and login is blocked.
  const okAfter = await api('/api/me', { token: u.token });
  assert.equal(okAfter.status, 403);
  const login = await api('/api/auth/login', {
    method: 'POST', body: { login: 'ban-me@example.com', password: 'secret1' },
  });
  assert.equal(login.status, 403);

  // Re-enabling restores access.
  await api(`/api/admin/users/${id}`, { method: 'PATCH', admin: ADMIN, body: { disabled: false } });
  const reLogin = await api('/api/auth/login', {
    method: 'POST', body: { login: 'ban-me@example.com', password: 'secret1' },
  });
  assert.equal(reLogin.status, 200);
});

test('admin can message a single user and export users as CSV', async () => {
  const u = await register('0681 2000004', 'csv@example.com', 'CsvUser');
  const list = await api('/api/admin/users?q=csv@example.com', { admin: ADMIN });
  const id = list.json.users.find((x) => x.email === 'csv@example.com').id;

  const msg = await api(`/api/admin/users/${id}/message`, {
    method: 'POST', admin: ADMIN, body: { title: 'Hi', body: 'Direkte Nachricht' },
  });
  assert.equal(msg.status, 200);
  assert.equal(msg.json.ok, true);

  const csvRes = await fetch(base + '/api/admin/users.csv', {
    headers: { 'x-admin-token': ADMIN },
  });
  assert.equal(csvRes.status, 200);
  const csv = await csvRes.text();
  assert.match(csv, /csv@example.com/);
  assert.match(csv, /^id,name,phone,email/);
});

test('admin can peek a chat\'s recent messages', async () => {
  const a = await register('0681 3000001', 'peek-a@example.com', 'PA');
  const b = await register('0681 3000002', 'peek-b@example.com', 'PB');
  const lookup = await api('/api/users/lookup', {
    method: 'POST', token: a.token, body: { phone: '0681 3000002' },
  });
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { userId: lookup.json.user.id },
  });
  const chatId = chat.json.chat.id;
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Hallo Welt' },
  });

  const peek = await api(`/api/admin/chats/${chatId}/messages`, { admin: ADMIN });
  assert.equal(peek.status, 200);
  assert.ok(peek.json.messages.some((m) => m.preview === 'Hallo Welt'));
});

test('emoji reactions toggle and broadcast', async () => {
  const a = await register('0688 4000001', 'react-a@example.com', 'RA');
  const b = await register('0688 4000002', 'react-b@example.com', 'RB');
  const look = await api('/api/users/lookup', { method: 'POST', token: a.token, body: { phone: '0688 4000002' } });
  const chat = await api('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: look.json.user.id } });
  const chatId = chat.json.chat.id;
  const sent = await api(`/api/chats/${chatId}/messages`, { method: 'POST', token: a.token, body: { body: 'Reagier mal' } });
  const msgId = sent.json.message.id;

  // B reacts ❤️
  const r1 = await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, { method: 'POST', token: b.token, body: { emoji: '❤️' } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.added, true);
  assert.equal(r1.json.message.reactions['❤️'], 1);

  // A sees it in history, with myReactions empty for A.
  const hist = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  const m = hist.json.messages.find((x) => x.id === msgId);
  assert.equal(m.reactions['❤️'], 1);
  assert.deepEqual(m.myReactions, []);

  // B toggles ❤️ off.
  const r2 = await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, { method: 'POST', token: b.token, body: { emoji: '❤️' } });
  assert.equal(r2.json.added, false);
  assert.equal(r2.json.message.reactions['❤️'], undefined);
});

test('admin profile edits reach the user live (self-updated)', async () => {
  const u = await register('0681 5000001', 'live-edit@example.com', 'Before Name');
  const ws = await connect(u.token);
  await waitFor(ws, 'ready');

  const list = await api('/api/admin/users?q=live-edit@example.com', { admin: ADMIN });
  const id = list.json.users.find((x) => x.email === 'live-edit@example.com').id;

  await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { displayName: 'After Name' },
  });
  const ev = await waitFor(ws, 'self-updated');
  assert.equal(ev.user.displayName, 'After Name');
  ws.close();
});

test('disabling a user forces their live sessions to log out', async () => {
  const u = await register('0681 5000002', 'kick-me@example.com', 'Kick');
  const ws = await connect(u.token);
  await waitFor(ws, 'ready');

  const list = await api('/api/admin/users?q=kick-me@example.com', { admin: ADMIN });
  const id = list.json.users.find((x) => x.email === 'kick-me@example.com').id;

  await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { disabled: true },
  });
  const ev = await waitFor(ws, 'force-logout');
  assert.equal(ev.reason, 'disabled');
});

test('admin broadcast accepts an optional deep-link route', async () => {
  const sent = await api('/api/admin/broadcast', {
    method: 'POST', admin: ADMIN,
    body: { title: 'Datenschutz', body: 'Bitte prüfen', route: 'privacy' },
  });
  assert.equal(sent.status, 200);

  // An unknown route is rejected by validation.
  const bad = await api('/api/admin/broadcast', {
    method: 'POST', admin: ADMIN,
    body: { body: 'Test', route: 'not-a-real-route' },
  });
  assert.equal(bad.status, 400);
});

test('download info exposes the build number for auto-update', async () => {
  const info = await fetch(base + '/download/info');
  if (info.status === 200) {
    const json = await info.json();
    assert.ok(typeof json.version === 'string');
    // build + versionCode are present when version.json ships a "+<code>" build.
    assert.ok('build' in json);
    assert.ok('versionCode' in json);
  } else {
    assert.equal(info.status, 404); // no build published — also valid
  }
});

test('scheduled messages: schedule, list, reject past, cancel, sweep delivers', async () => {
  const a = await register('0699 2500001', 'sch-a@example.com', 'SchA');
  const b = await register('0699 2500002', 'sch-b@example.com', 'SchB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0699 2500002' },
  });
  const chatId = chat.json.chat.id;

  // Schedule a future message.
  const sch = await api(`/api/chats/${chatId}/schedule`, {
    method: 'POST', token: a.token,
    body: { body: 'später', sendAt: Date.now() + 3600_000 },
  });
  assert.equal(sch.status, 201);
  assert.equal(sch.json.scheduled.body, 'später');

  // It shows in the sender's scheduled list.
  const list = await api(`/api/chats/${chatId}/scheduled`, { token: a.token });
  assert.equal(list.json.scheduled.length, 1);

  // Past timestamps are rejected.
  const bad = await api(`/api/chats/${chatId}/schedule`, {
    method: 'POST', token: a.token, body: { body: 'x', sendAt: Date.now() - 1000 },
  });
  assert.equal(bad.status, 400);

  // Cancelling removes it.
  const del = await api(`/api/chats/${chatId}/scheduled/${sch.json.scheduled.id}`, {
    method: 'DELETE', token: a.token,
  });
  assert.equal(del.status, 204);
  const list2 = await api(`/api/chats/${chatId}/scheduled`, { token: a.token });
  assert.equal(list2.json.scheduled.length, 0);

  // A due row is delivered by the maintenance sweep and dequeued.
  createScheduled({
    chatId, senderId: a.user.id, type: 'text',
    body: 'jetzt fällig', sendAt: Date.now() - 1000,
  });
  const result = runMaintenance();
  assert.ok(result.deliveredScheduled >= 1);
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.ok(hist.json.messages.some((m) => m.body === 'jetzt fällig'));
});

test('group invite links: create, join by code, idempotent, revoke', async () => {
  const owner = await register('0699 9500001', 'inv-o@example.com', 'InvOwner');
  const joiner = await register('0699 9500002', 'inv-j@example.com', 'InvJoiner');

  const grp = await api('/api/chats/group', {
    method: 'POST', token: owner.token, body: { name: 'Community', memberIds: [] },
  });
  assert.equal(grp.status, 201);
  const gid = grp.json.chat.id;

  // Owner mints an invite link.
  const inv = await api(`/api/chats/${gid}/invite`, { method: 'POST', token: owner.token });
  assert.equal(inv.status, 200);
  const code = inv.json.code;
  assert.ok(code && code.length >= 4);

  // Joiner joins by code.
  const join = await api('/api/chats/join', {
    method: 'POST', token: joiner.token, body: { code },
  });
  assert.equal(join.status, 201);
  assert.equal(join.json.joined, true);
  assert.equal(join.json.chat.id, gid);

  // Re-joining is idempotent.
  const again = await api('/api/chats/join', {
    method: 'POST', token: joiner.token, body: { code },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.joined, false);

  // Bogus codes 404.
  const bad = await api('/api/chats/join', {
    method: 'POST', token: joiner.token, body: { code: 'nope-nope' },
  });
  assert.equal(bad.status, 404);

  // A non-owner can't rotate the link.
  const rot = await api(`/api/chats/${gid}/invite`, { method: 'POST', token: joiner.token });
  assert.equal(rot.status, 403);

  // Owner revokes → the code stops working.
  const del = await api(`/api/chats/${gid}/invite`, { method: 'DELETE', token: owner.token });
  assert.equal(del.status, 204);
  const after = await api('/api/chats/join', {
    method: 'POST', token: joiner.token, body: { code },
  });
  assert.equal(after.status, 404);
});

test('webrtc: ice config + call signaling relay between two users', async () => {
  const a = await register('0699 9600001', 'call-a@example.com', 'CallA');
  const b = await register('0699 9600002', 'call-b@example.com', 'CallB');

  // ICE config is auth-gated and always offers at least a STUN server.
  const ice = await api('/api/ice', { token: a.token });
  assert.equal(ice.status, 200);
  assert.ok(ice.json.iceServers[0].urls.startsWith('stun:'));
  assert.equal((await api('/api/ice')).status, 401);

  // Signaling relay: A's offer reaches B, tagged with from=A.
  const aWs = await connect(a.token);
  await waitFor(aWs, 'ready');
  const bWs = await connect(b.token);
  await waitFor(bWs, 'ready');

  aWs.send(JSON.stringify({
    type: 'call-offer',
    payload: { to: b.user.id, sdp: 'OFFER', video: true },
  }));
  const offer = await waitFor(bWs, 'call-offer');
  assert.equal(offer.from.id, a.user.id);
  assert.equal(offer.sdp, 'OFFER');
  assert.equal(offer.video, true);

  // B answers; A receives it.
  bWs.send(JSON.stringify({
    type: 'call-answer',
    payload: { to: a.user.id, sdp: 'ANSWER' },
  }));
  const answer = await waitFor(aWs, 'call-answer');
  assert.equal(answer.from.id, b.user.id);
  assert.equal(answer.sdp, 'ANSWER');

  aWs.close();
  bWs.close();
});

test('remote config: public defaults, admin update, public reflects', async () => {
  // Public endpoint returns the built-in defaults.
  const pub = await fetch(base + '/api/config');
  assert.equal(pub.status, 200);
  const def = await pub.json();
  assert.equal(def.flags.polls, true);
  assert.equal(def.flags.calls, false);
  assert.equal(def.values.maxStatusSeconds, 30);
  assert.equal(def.notice, null);

  // Admin updates a flag, the notice and the minimum supported build.
  const upd = await api('/api/admin/config', {
    method: 'PUT',
    admin: ADMIN,
    body: {
      flags: { calls: true },
      notice: { text: 'Wartung heute 22 Uhr', level: 'warning' },
      minSupportedBuild: 12,
    },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.flags.calls, true);
  assert.equal(upd.json.flags.polls, true); // untouched flags are preserved
  assert.equal(upd.json.minSupportedBuild, 12);
  assert.equal(upd.json.notice.text, 'Wartung heute 22 Uhr');

  // The public endpoint reflects the change (no app update needed).
  const pub2 = await (await fetch(base + '/api/config')).json();
  assert.equal(pub2.flags.calls, true);
  assert.equal(pub2.notice.level, 'warning');

  // The notice can be cleared back to null.
  const cleared = await api('/api/admin/config', {
    method: 'PUT', admin: ADMIN, body: { notice: null },
  });
  assert.equal(cleared.json.notice, null);
  assert.equal(cleared.json.flags.calls, true); // other fields untouched

  // Writing requires the admin token, and the schema is strict.
  const noauth = await api('/api/admin/config', {
    method: 'PUT', body: { flags: { calls: false } },
  });
  assert.equal(noauth.status, 401);
  const bad = await api('/api/admin/config', {
    method: 'PUT', admin: ADMIN, body: { bogus: 1 },
  });
  assert.equal(bad.status, 400);
});

test('two users can start a chat and message each other', async () => {
  const a = await register('0699 1000001', 'msg-a@example.com', 'MsgA');
  const b = await register('0699 1000002', 'msg-b@example.com', 'MsgB');
  const wsB = await connect(b.token);
  await waitFor(wsB, 'ready');

  // A starts a direct chat with B by phone number.
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0699 1000002' },
  });
  assert.equal(chat.status, 201);
  const chatId = chat.json.chat.id;

  // B is told about the new chat live, then A's message arrives over the socket.
  const created = await waitFor(wsB, 'chat-created');
  assert.equal(created.chat.id, chatId);
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Hallo Bob!' },
  });
  assert.equal(sent.status, 201);
  const live = await waitFor(wsB, 'message');
  assert.equal(live.message.body, 'Hallo Bob!');

  // And B sees it in history (server-stored).
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.ok(hist.json.messages.some((m) => m.body === 'Hallo Bob!'));
  wsB.close();
});

test('admin sends a real DM into a read-only Ping Team channel', async () => {
  const u = await register('0699 2000001', 'dm-target@example.com', 'DmTarget');
  const ws = await connect(u.token);
  await waitFor(ws, 'ready');
  const list = await api('/api/admin/users?q=dm-target@example.com', { admin: ADMIN });
  const id = list.json.users.find((x) => x.email === 'dm-target@example.com').id;

  const dm = await api(`/api/admin/users/${id}/dm`, {
    method: 'POST', admin: ADMIN, body: { body: 'Willkommen bei Ping!' },
  });
  assert.equal(dm.status, 200);
  assert.equal(dm.json.ok, true);

  // The channel appears + the message is delivered live.
  const created = await waitFor(ws, 'chat-created');
  assert.equal(created.chat.locked, true);
  const chatId = created.chat.id;
  const live = await waitFor(ws, 'message');
  assert.equal(live.message.body, 'Willkommen bei Ping!');

  // The user can't reply into the locked channel.
  const reply = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: u.token, body: { body: 'Darf ich antworten?' },
  });
  assert.equal(reply.status, 403);
  ws.close();
});

test('admin broadcast-dm reaches every user privately', async () => {
  const a = await register('0699 3000001', 'bdm-a@example.com', 'BdmA');
  const b = await register('0699 3000002', 'bdm-b@example.com', 'BdmB');

  const res = await api('/api/admin/broadcast-dm', {
    method: 'POST', admin: ADMIN, body: { body: 'Wartungsarbeiten heute Abend.' },
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.delivered >= 2);

  // Both users now have a Ping Team chat carrying the message.
  for (const tok of [a.token, b.token]) {
    const chats = await api('/api/chats', { token: tok });
    const team = chats.json.chats.find((c) => c.locked === true);
    assert.ok(team, 'expected a locked Ping Team chat');
    assert.equal(team.lastMessage.body, 'Wartungsarbeiten heute Abend.');
  }
});

test('admin posts an official status every user can see', async () => {
  const viewer = await register('0699 4000001', 'status-view@example.com', 'StatusView');
  const posted = await api('/api/admin/status', {
    method: 'POST', admin: ADMIN, body: { body: 'Frohe Feiertage!', bgColor: '#26A69A' },
  });
  assert.equal(posted.status, 201);

  // A brand-new user with no shared chats still sees the Ping Team status.
  const feed = await api('/api/status', { token: viewer.token });
  const team = feed.json.others.find((o) => o.user.displayName === 'Ping Team');
  assert.ok(team, 'expected the official status in the feed');
  assert.ok(team.items.some((i) => i.body === 'Frohe Feiertage!'));
  // The Ping Team account is flagged official so the app can badge it.
  assert.equal(team.user.official, true);
});

test('admin uploads media and posts an image status for everyone', async () => {
  const viewer = await register('0699 4100001', 'media-status@example.com', 'MediaStatus');

  // Upload an image via the admin-token-gated upload twin.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await fetch(base + '/api/admin/upload', {
    method: 'POST',
    headers: {
      'x-admin-token': ADMIN,
      'content-type': 'image/png',
      'x-filename': 'announcement.png',
    },
    body: png,
  });
  const upJson = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upJson));
  assert.equal(upJson.upload.kind, 'image');

  const posted = await api('/api/admin/status', {
    method: 'POST', admin: ADMIN,
    body: { type: 'image', attachment: { url: upJson.upload.url }, body: 'Neu!' },
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.json));
  assert.equal(posted.json.status.type, 'image');
  assert.ok(posted.json.status.attachment, 'expected an attachment on the status');

  // Every user sees the image status, and can fetch its media with their JWT.
  const feed = await api('/api/status', { token: viewer.token });
  const team = feed.json.others.find((o) => o.user.official === true);
  assert.ok(team, 'expected the official status group');
  const img = team.items.find((i) => i.type === 'image');
  assert.ok(img && img.attachment, 'expected an image status item');
  const media = await fetch(base + img.attachment.url, {
    headers: { authorization: `Bearer ${viewer.token}` },
  });
  assert.equal(media.status, 200);
});

test('admin grants Ping Premium and peers see the badge flag', async () => {
  const a = await register('0699 4200001', 'prem-a@example.com', 'PremA');
  const b = await register('0699 4200002', 'prem-b@example.com', 'PremB');
  // They share a chat so A appears in B's public views.
  await api('/api/chats/direct', {
    method: 'POST', token: b.token, body: { phone: a.user.phone },
  });

  const grant = await api(`/api/admin/users/${a.user.id}`, {
    method: 'PATCH', admin: ADMIN, body: { premium: true },
  });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.equal(grant.json.user.premium, true);

  // B's chat list now shows A flagged premium (publicUser surfaces it).
  const chats = await api('/api/chats', { token: b.token });
  const direct = chats.json.chats.find((c) => c.otherUser && c.otherUser.id === a.user.id);
  assert.ok(direct, 'expected the direct chat');
  assert.equal(direct.otherUser.premium, true);

  // Revoking clears it again.
  const revoke = await api(`/api/admin/users/${a.user.id}`, {
    method: 'PATCH', admin: ADMIN, body: { premium: false },
  });
  assert.equal(revoke.json.user.premium, false);
});

test('the official Ping Team account is protected from admin edits/deletion', async () => {
  const patch = await api('/api/admin/users/ping-official', {
    method: 'PATCH', admin: ADMIN, body: { displayName: 'Hacked' },
  });
  assert.equal(patch.status, 403);

  const del = await api('/api/admin/users/ping-official', {
    method: 'DELETE', admin: ADMIN,
  });
  assert.equal(del.status, 403);
});

// ---- v0.3.0: password reset, archive, search, privacy, hardening ------------

test('forgot-password: SMS code flow resets the password', async () => {
  await register('0699 5000001', 'reset-me@example.com', 'ResetMe', 'oldpass1');

  // Request a reset code (the 'log' SMS provider returns it as devCode).
  const reqd = await api('/api/auth/request-code', {
    method: 'POST', body: { phone: '0699 5000001', purpose: 'reset' },
  });
  assert.equal(reqd.status, 200, JSON.stringify(reqd.json));
  assert.ok(reqd.json.devCode);

  const ver = await api('/api/auth/verify-code', {
    method: 'POST', body: { phone: '0699 5000001', code: reqd.json.devCode },
  });
  assert.equal(ver.status, 200);

  const reset = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { phone: '0699 5000001', verifyToken: ver.json.verifyToken, password: 'newpass1' },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.ok(reset.json.token);

  // Old password is dead, the new one works.
  const oldLogin = await api('/api/auth/login', {
    method: 'POST', body: { login: '0699 5000001', password: 'oldpass1' },
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api('/api/auth/login', {
    method: 'POST', body: { login: '0699 5000001', password: 'newpass1' },
  });
  assert.equal(newLogin.status, 200);
});

test('request-code rejects mismatched purposes', async () => {
  // Registering with an already-taken number is refused up front…
  const taken = await api('/api/auth/request-code', {
    method: 'POST', body: { phone: '0699 5000001', purpose: 'register' },
  });
  assert.equal(taken.status, 409);
  // …and a reset for a number without an account is too.
  const unknown = await api('/api/auth/request-code', {
    method: 'POST', body: { phone: '0699 5999999', purpose: 'reset' },
  });
  assert.equal(unknown.status, 404);
});

test('reset-password refuses a token for a different number', async () => {
  await register('0699 5000002', 'reset-b@example.com', 'ResetB');
  const reqd = await api('/api/auth/request-code', {
    method: 'POST', body: { phone: '0699 5000002', purpose: 'reset' },
  });
  const ver = await api('/api/auth/verify-code', {
    method: 'POST', body: { phone: '0699 5000002', code: reqd.json.devCode },
  });
  const wrong = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { phone: '0699 5000001', verifyToken: ver.json.verifyToken, password: 'hijack1' },
  });
  assert.equal(wrong.status, 401);
});

test('archiving a chat is per-user and reversible', async () => {
  const a = await register('0699 6000001', 'arch-a@example.com', 'ArchA');
  const b = await register('0699 6000002', 'arch-b@example.com', 'ArchB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0699 6000002' },
  });
  const chatId = chat.json.chat.id;

  const arch = await api(`/api/chats/${chatId}/archive`, {
    method: 'POST', token: a.token, body: { archived: true },
  });
  assert.equal(arch.status, 200);

  const aChats = await api('/api/chats', { token: a.token });
  assert.equal(aChats.json.chats.find((c) => c.id === chatId).archived, true);
  // B's view is untouched.
  const bChats = await api('/api/chats', { token: b.token });
  assert.equal(bChats.json.chats.find((c) => c.id === chatId).archived, false);

  await api(`/api/chats/${chatId}/archive`, {
    method: 'POST', token: a.token, body: { archived: false },
  });
  const again = await api('/api/chats', { token: a.token });
  assert.equal(again.json.chats.find((c) => c.id === chatId).archived, false);
});

test('global message search finds matches across chats', async () => {
  const a = await register('0699 7000001', 'search-a@example.com', 'SearchA');
  const b = await register('0699 7000002', 'search-b@example.com', 'SearchB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0699 7000002' },
  });
  const chatId = chat.json.chat.id;
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Treffen am Donnerstagabend im Café' },
  });
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token, body: { body: 'Passt, bis Donnerstag!' },
  });

  const hits = await api('/api/messages/search?q=donnerstag', { token: a.token });
  assert.equal(hits.status, 200);
  assert.equal(hits.json.messages.length, 2);

  // An outsider sees nothing from this chat.
  const c = await register('0699 7000003', 'search-c@example.com', 'SearchC');
  const none = await api('/api/messages/search?q=donnerstag', { token: c.token });
  assert.equal(none.json.messages.length, 0);

  // Queries below 2 chars are rejected.
  const short = await api('/api/messages/search?q=x', { token: a.token });
  assert.equal(short.status, 400);
});

test('hiding "zuletzt online" blanks lastSeen for others only', async () => {
  const a = await register('0699 8000001', 'seen-a@example.com', 'SeenA');
  const b = await register('0699 8000002', 'seen-b@example.com', 'SeenB');
  await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: '0699 8000002' },
  });

  // Default: B's lastSeen is visible to A.
  const before = await api(`/api/users/${b.user.id}`, { token: a.token });
  assert.ok(before.json.user.lastSeen != null);

  const setp = await api('/api/me/privacy', {
    method: 'POST', token: b.token, body: { showLastSeen: false },
  });
  assert.equal(setp.status, 200);
  assert.equal(setp.json.user.showLastSeen, false);
  // B still sees their own timestamp.
  assert.ok(setp.json.user.lastSeen != null);

  const after = await api(`/api/users/${b.user.id}`, { token: a.token });
  assert.equal(after.json.user.lastSeen, null);
});

test('opening a chat with the Ping Team is read-only from the start', async () => {
  const u = await register('0699 9000001', 'team-chat@example.com', 'TeamChat');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: u.token, body: { userId: 'ping-official' },
  });
  assert.equal(chat.status, 201);
  assert.equal(chat.json.chat.locked, true);
  const send = await api(`/api/chats/${chat.json.chat.id}/messages`, {
    method: 'POST', token: u.token, body: { body: 'Hallo Team' },
  });
  assert.equal(send.status, 403);
});

test('a disabled admin loses admin API access immediately', async () => {
  const u = await register('0699 9100001', 'exadmin@example.com', 'ExAdmin');
  const list = await api('/api/admin/users?q=exadmin@example.com', { admin: ADMIN });
  const id = list.json.users[0].id;
  await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { isAdmin: true },
  });

  // As a live admin the bearer token works on the admin API…
  const ok = await api('/api/admin/stats', { token: u.token });
  assert.equal(ok.status, 200);

  await api(`/api/admin/users/${id}`, {
    method: 'PATCH', admin: ADMIN, body: { disabled: true },
  });
  // …but a disabled account is locked out of both the admin and the user API.
  const denied = await api('/api/admin/stats', { token: u.token });
  assert.equal(denied.status, 401);
  const me = await api('/api/me', { token: u.token });
  assert.equal(me.status, 403);
});

// ---- v0.4.0: Umfragen (Polls) ----------------------------------------------

test('polls: create, vote, multi-toggle and single-choice move', async () => {
  const a = await register('+431780000001', 'poll-a@example.com', 'PollA');
  const b = await register('+431780000002', 'poll-b@example.com', 'PollB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;

  // Validation: too few options is rejected.
  const tooFew = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token, body: { question: 'Hm?', options: ['Nur eine'] },
  });
  assert.equal(tooFew.status, 400);

  const wsB = await connect(b.token);
  const created = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token,
    body: { question: 'Pizza heute Abend?', options: ['Ja', 'Nein', 'Vielleicht'] },
  });
  assert.equal(created.status, 201);
  const msg = created.json.message;
  assert.equal(msg.type, 'poll');
  assert.equal(msg.poll.question, 'Pizza heute Abend?');
  assert.equal(msg.poll.options.length, 3);
  assert.equal(msg.poll.totalVoters, 0);

  // B receives the poll live.
  const live = await waitFor(wsB, 'message');
  assert.equal(live.message.poll.question, 'Pizza heute Abend?');

  // B votes "Ja" → counts update; A would get message-updated (B checks own response).
  const vote = await api(`/api/chats/${chatId}/messages/${msg.id}/vote`, {
    method: 'POST', token: b.token, body: { option: 0 },
  });
  assert.equal(vote.status, 200);
  assert.equal(vote.json.message.poll.options[0].votes, 1);
  assert.deepEqual(vote.json.message.poll.myVotes, [0]);

  // Single choice: voting "Nein" moves the vote instead of adding one.
  const move = await api(`/api/chats/${chatId}/messages/${msg.id}/vote`, {
    method: 'POST', token: b.token, body: { option: 1 },
  });
  assert.equal(move.json.message.poll.options[0].votes, 0);
  assert.equal(move.json.message.poll.options[1].votes, 1);
  assert.equal(move.json.message.poll.totalVoters, 1);

  // Voting the same option again toggles it off.
  const off = await api(`/api/chats/${chatId}/messages/${msg.id}/vote`, {
    method: 'POST', token: b.token, body: { option: 1 },
  });
  assert.equal(off.json.message.poll.totalVoters, 0);

  // Out-of-range option → 400.
  const bad = await api(`/api/chats/${chatId}/messages/${msg.id}/vote`, {
    method: 'POST', token: b.token, body: { option: 9 },
  });
  assert.equal(bad.status, 400);

  // Multi-choice keeps several picks at once.
  const multi = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token,
    body: { question: 'Beläge?', options: ['Salami', 'Mais', 'Pilze'], multi: true },
  });
  const mid = multi.json.message.id;
  await api(`/api/chats/${chatId}/messages/${mid}/vote`, {
    method: 'POST', token: b.token, body: { option: 0 },
  });
  const second = await api(`/api/chats/${chatId}/messages/${mid}/vote`, {
    method: 'POST', token: b.token, body: { option: 2 },
  });
  assert.deepEqual(second.json.message.poll.myVotes.sort(), [0, 2]);
  wsB.close();
});

// ---- v0.4.0: Selbstlöschende Nachrichten ------------------------------------

test('disappearing messages: timer set, ttl applied, purge removes + notifies', async () => {
  const { db } = await import('../src/db.js');
  const { runMaintenance } = await import('../src/maintenance.js');

  const a = await register('+431780000011', 'ttl-a@example.com', 'ExpA');
  const b = await register('+431780000012', 'ttl-b@example.com', 'ExpB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;

  // Either side of a direct chat may set the timer.
  const set = await api(`/api/chats/${chatId}/expire`, {
    method: 'POST', token: b.token, body: { seconds: 3600 },
  });
  assert.equal(set.status, 200);
  assert.equal(set.json.chat.expireSeconds, 3600);

  // New messages now carry an expiry; the system note about the timer doesn't.
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'verschwindet bald' },
  });
  assert.ok(sent.json.message.expiresAt > Date.now());

  // Fudge the clock: force-expire the message, then run the sweeper.
  const wsA = await connect(a.token);
  db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?')
    .run(Date.now() - 1000, sent.json.message.id);
  runMaintenance();
  const purged = await waitFor(wsA, 'message-purged');
  assert.equal(purged.messageId, sent.json.message.id);

  const history = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  assert.ok(!history.json.messages.some((m) => m.id === sent.json.message.id));

  // Turning the timer off stops new expiries.
  const off = await api(`/api/chats/${chatId}/expire`, {
    method: 'POST', token: a.token, body: { seconds: 0 },
  });
  assert.equal(off.json.chat.expireSeconds, 0);
  const plain = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'bleibt' },
  });
  assert.equal(plain.json.message.expiresAt, null);
  wsA.close();
});

test('disappearing messages: only the owner may set a group timer', async () => {
  const owner = await register('+431780000013', 'exp-own@example.com', 'ExpOwn');
  const member = await register('+431780000014', 'exp-mem@example.com', 'ExpMem');
  const group = await api('/api/chats/group', {
    method: 'POST', token: owner.token,
    body: { name: 'Timer-Gruppe', memberIds: [member.user.id] },
  });
  const gid = group.json.chat.id;
  const denied = await api(`/api/chats/${gid}/expire`, {
    method: 'POST', token: member.token, body: { seconds: 86400 },
  });
  assert.equal(denied.status, 403);
  const ok = await api(`/api/chats/${gid}/expire`, {
    method: 'POST', token: owner.token, body: { seconds: 86400 },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.chat.expireSeconds, 86400);
});

// ---- v0.4.0: Für mich löschen ------------------------------------------------

test('hide for me: message disappears for one user only', async () => {
  const a = await register('+431780000021', 'hide-a@example.com', 'HideA');
  const b = await register('+431780000022', 'hide-b@example.com', 'HideB');
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'peinlich' },
  });
  const msgId = msg.json.message.id;

  // B hides A's message for themselves.
  const hide = await api(`/api/chats/${chatId}/messages/${msgId}/hide`, {
    method: 'POST', token: b.token,
  });
  assert.equal(hide.status, 200);

  const forB = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.ok(!forB.json.messages.some((m) => m.id === msgId));
  const forA = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  assert.ok(forA.json.messages.some((m) => m.id === msgId));

  // The chat-list preview and the global search respect it too.
  const chatsB = await api('/api/chats', { token: b.token });
  const cb = chatsB.json.chats.find((c) => c.id === chatId);
  assert.notEqual(cb.lastMessage?.id, msgId);
  const search = await api('/api/messages/search?q=peinlich', { token: b.token });
  assert.ok(!search.json.messages.some((m) => m.id === msgId));
  const searchA = await api('/api/messages/search?q=peinlich', { token: a.token });
  assert.ok(searchA.json.messages.some((m) => m.id === msgId));
});

// ---- v0.6.0: Newsroom, Changelog & public stats -----------------------------

test('admin can create/list/update/delete posts; public only sees published', async () => {
  // Create a published news article + a draft.
  const created = await api('/api/admin/posts', {
    method: 'POST', admin: ADMIN,
    body: { kind: 'news', title: 'Ping startet durch', summary: 'Großes Update', body: 'Hallo Welt', category: 'Produkt' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.post.slug, 'ping-startet-durch');
  assert.equal(created.json.post.published, true);

  const draft = await api('/api/admin/posts', {
    method: 'POST', admin: ADMIN,
    body: { kind: 'news', title: 'Geheimer Entwurf', published: false },
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.json.post.published, false);

  // Admin list shows both (draft included).
  const adminList = await api('/api/admin/posts?kind=news', { admin: ADMIN });
  assert.ok(adminList.json.posts.some((p) => p.id === created.json.post.id));
  assert.ok(adminList.json.posts.some((p) => p.id === draft.json.post.id));

  // Public list shows the published one only.
  const pub = await api('/api/news');
  assert.ok(pub.json.posts.some((p) => p.slug === 'ping-startet-durch'));
  assert.ok(!pub.json.posts.some((p) => p.id === draft.json.post.id));

  // Public single-article lookup by slug works; the draft 404s.
  const one = await api('/api/news/ping-startet-durch');
  assert.equal(one.status, 200);
  assert.equal(one.json.post.title, 'Ping startet durch');
  const draftSlug = draft.json.post.slug;
  const hidden = await api('/api/news/' + draftSlug);
  assert.equal(hidden.status, 404);

  // Publishing the draft makes it public.
  const upd = await api('/api/admin/posts/' + draft.json.post.id, {
    method: 'PATCH', admin: ADMIN, body: { published: true },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.post.published, true);
  assert.ok((await api('/api/news/' + draftSlug)).json.post);

  // Delete it again.
  const del = await api('/api/admin/posts/' + draft.json.post.id, {
    method: 'DELETE', admin: ADMIN,
  });
  assert.equal(del.status, 204);
  assert.equal((await api('/api/news/' + draftSlug)).status, 404);
});

test('changelog posts are a separate kind and not mixed into news', async () => {
  await api('/api/admin/posts', {
    method: 'POST', admin: ADMIN,
    body: { kind: 'changelog', title: 'v0.6.0', version: '0.6.0', tag: 'feature', body: 'Newsroom + Changelog' },
  });
  const log = await api('/api/changelog');
  assert.ok(log.json.posts.some((p) => p.version === '0.6.0' && p.tag === 'feature'));
  const news = await api('/api/news');
  assert.ok(!news.json.posts.some((p) => p.version === '0.6.0'));
});

test('posts require the admin token', async () => {
  const r = await api('/api/admin/posts', {
    method: 'POST', body: { kind: 'news', title: 'Ohne Token' },
  });
  assert.equal(r.status, 401);
});

test('public stats expose non-sensitive aggregate counters', async () => {
  const r = await api('/api/public/stats');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.users, 'number');
  assert.equal(typeof r.json.messages, 'number');
  assert.ok(r.json.version);
  // No per-user fields leak.
  assert.equal(r.json.phone, undefined);
  assert.equal(r.json.email, undefined);
});

test('ice servers are returned to authenticated users and include STUN', async () => {
  const a = await register('+4915900200001', 'icetest-a@example.com', 'Ice A');
  const anon = await api('/api/ice');
  assert.equal(anon.status, 401);
  const r = await api('/api/ice', { token: a.token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.iceServers));
  assert.ok(r.json.iceServers.length >= 1);
  assert.ok(
    r.json.iceServers.some((s) =>
      (Array.isArray(s.urls) ? s.urls.join(' ') : s.urls || '').includes('stun:')
    ),
    'expected at least one STUN server'
  );
});

test('call log: record a call, list it, and clear it', async () => {
  const a = await register('+4915900200002', 'clog-a@example.com', 'Call A');
  const b = await register('+4915900200003', 'clog-b@example.com', 'Call B');

  // A records an outgoing, completed 42s call to B.
  const made = await api('/api/calls', {
    method: 'POST',
    token: a.token,
    body: {
      peerId: b.user.id,
      callId: 'call-xyz',
      direction: 'outgoing',
      video: true,
      outcome: 'completed',
      duration: 42,
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.call.outcome, 'completed');
  assert.equal(made.json.call.duration, 42);
  assert.equal(made.json.call.peer.id, b.user.id);
  // The peer's phone/email never leak into a call entry.
  assert.equal(made.json.call.peer.phone, undefined);
  assert.equal(made.json.call.peer.email, undefined);

  // Re-posting the same callId updates rather than duplicating it.
  await api('/api/calls', {
    method: 'POST',
    token: a.token,
    body: {
      peerId: b.user.id,
      callId: 'call-xyz',
      direction: 'outgoing',
      outcome: 'completed',
      duration: 60,
    },
  });
  const list = await api('/api/calls', { token: a.token });
  assert.equal(list.status, 200);
  const mine = list.json.calls.filter((c) => c.callId === 'call-xyz');
  assert.equal(mine.length, 1, 'same call id must not duplicate');
  assert.equal(mine[0].duration, 60);

  // B's log is independent (and currently empty for this call id).
  const bList = await api('/api/calls', { token: b.token });
  assert.ok(!bList.json.calls.some((c) => c.callId === 'call-xyz'));

  // Clearing wipes only the caller's own history.
  const cleared = await api('/api/calls', { method: 'DELETE', token: a.token });
  assert.equal(cleared.status, 200);
  const after = await api('/api/calls', { token: a.token });
  assert.equal(after.json.calls.length, 0);
});

test('call log rejects logging a call with yourself and unknown peers', async () => {
  const a = await register('+4915900200004', 'clog-c@example.com', 'Call C');
  const self = await api('/api/calls', {
    method: 'POST',
    token: a.token,
    body: { peerId: a.user.id, callId: 'c1', direction: 'outgoing', outcome: 'completed' },
  });
  assert.equal(self.status, 400);
  const ghost = await api('/api/calls', {
    method: 'POST',
    token: a.token,
    body: { peerId: 'nobody', callId: 'c2', direction: 'outgoing', outcome: 'missed' },
  });
  assert.equal(ghost.status, 404);
});
