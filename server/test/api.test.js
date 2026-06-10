import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.DB_FILE = `:memory:`;
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');

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

  const ok = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Du bist blockiert' },
  });
  assert.equal(ok.status, 201);

  await api(`/api/users/${b.user.id}/unblock`, { method: 'POST', token: a.token });
  const after = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token, body: { body: 'Wieder da' },
  });
  assert.equal(after.status, 201);
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
