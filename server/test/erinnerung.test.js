// 0.29.0 "Erinnerung & Schnellzugriff": message reminders, quick replies (canned
// responses) and per-chat transcript export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');
const { createReminder, listReminders } = await import('../src/remindersRepo.js');
const { runMaintenance } = await import('../src/maintenance.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', token, body, raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function register(phone, email, name) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName: name, password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

async function fixture(seq) {
  const a = await register(`+49171000${seq}0`, `a${seq}@e.com`, `Alice${seq}`);
  const b = await register(`+49171000${seq}1`, `b${seq}@e.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: `hallo ${seq}` },
  });
  return { a, b, chatId, msgId: msg.json.message.id };
}

// ---- Message reminders -----------------------------------------------------

test('create a reminder, list it, then delete it', async () => {
  const { a, chatId, msgId } = await fixture('10');
  const remindAt = Date.now() + 60 * 60 * 1000;

  const created = await api(`/api/chats/${chatId}/messages/${msgId}/remind`, {
    method: 'POST', token: a.token, body: { remindAt, note: 'zurückrufen' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const rem = created.json.reminder;
  assert.equal(rem.remindAt, remindAt);
  assert.equal(rem.note, 'zurückrufen');
  assert.equal(rem.messageId, msgId);
  assert.equal(rem.firedAt, null);
  assert.ok(rem.preview.includes('hallo 10'), 'snapshot captures the message preview');

  const list = await api('/api/me/reminders', { token: a.token });
  assert.equal(list.json.reminders.length, 1);
  assert.equal(list.json.reminders[0].id, rem.id);

  const del = await api(`/api/me/reminders/${rem.id}`, { method: 'DELETE', token: a.token });
  assert.equal(del.status, 204);
  const empty = await api('/api/me/reminders', { token: a.token });
  assert.equal(empty.json.reminders.length, 0);
});

test('a reminder in the past is rejected', async () => {
  const { a, chatId, msgId } = await fixture('11');
  const r = await api(`/api/chats/${chatId}/messages/${msgId}/remind`, {
    method: 'POST', token: a.token, body: { remindAt: Date.now() - 10 * 60 * 1000 },
  });
  assert.equal(r.status, 400);
});

test('non-members cannot set a reminder', async () => {
  const { chatId, msgId } = await fixture('12');
  const mallory = await register('+491710001299', 'm12@e.com', 'Mallory');
  const r = await api(`/api/chats/${chatId}/messages/${msgId}/remind`, {
    method: 'POST', token: mallory.token, body: { remindAt: Date.now() + 1000000 },
  });
  assert.equal(r.status, 403);
});

test('reminders are private and cannot be deleted by others', async () => {
  const { a, b, chatId, msgId } = await fixture('13');
  const created = await api(`/api/chats/${chatId}/messages/${msgId}/remind`, {
    method: 'POST', token: a.token, body: { remindAt: Date.now() + 1000000 },
  });
  const rid = created.json.reminder.id;
  // Bob is in the chat but the reminder belongs to Alice.
  assert.equal((await api('/api/me/reminders', { token: b.token })).json.reminders.length, 0);
  assert.equal((await api(`/api/me/reminders/${rid}`, { method: 'DELETE', token: b.token })).status, 404);
  assert.equal((await api('/api/me/reminders', { token: a.token })).json.reminders.length, 1);
});

test('the maintenance sweep fires due reminders and marks them fired', async () => {
  const { a, chatId, msgId } = await fixture('14');
  // Seed a reminder whose time has already passed (the repo doesn't validate, so
  // we can simulate "due" without waiting).
  createReminder({
    userId: a.user.id,
    chatId,
    messageId: msgId,
    remindAt: Date.now() - 1000,
    note: 'fällig',
    preview: 'hallo 14',
    chatTitle: 'Bob14',
  });
  const stats = runMaintenance();
  assert.ok(stats.firedReminders >= 1, 'sweep reports at least one fired reminder');

  const after = listReminders(a.user.id);
  const fired = after.find((r) => r.note === 'fällig');
  assert.ok(fired && fired.fired_at, 'the due reminder is now stamped fired');

  // A second sweep does not re-fire it.
  const again = runMaintenance();
  assert.equal(again.firedReminders, 0);
});

// ---- Quick replies ---------------------------------------------------------

test('quick reply CRUD scoped to the owner', async () => {
  const { a } = await fixture('20');

  const created = await api('/api/me/quick-replies', {
    method: 'POST', token: a.token, body: { shortcut: 'gn8', text: 'Gute Nacht! 🌙' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const qr = created.json.quickReply;
  assert.equal(qr.shortcut, 'gn8');
  assert.equal(qr.text, 'Gute Nacht! 🌙');

  const list = await api('/api/me/quick-replies', { token: a.token });
  assert.equal(list.json.quickReplies.length, 1);

  const patched = await api(`/api/me/quick-replies/${qr.id}`, {
    method: 'PATCH', token: a.token, body: { text: 'Schlaf gut!' },
  });
  assert.equal(patched.json.quickReply.text, 'Schlaf gut!');
  assert.equal(patched.json.quickReply.shortcut, 'gn8', 'untouched fields are preserved');

  const del = await api(`/api/me/quick-replies/${qr.id}`, { method: 'DELETE', token: a.token });
  assert.equal(del.status, 204);
  assert.equal((await api('/api/me/quick-replies', { token: a.token })).json.quickReplies.length, 0);
});

test('quick replies validate input and stay private', async () => {
  const { a } = await fixture('21');
  const eve = await register('+491710002199', 'eve21@e.com', 'Eve');

  // Empty text is rejected.
  assert.equal((await api('/api/me/quick-replies', {
    method: 'POST', token: a.token, body: { text: '   ' },
  })).status, 400);
  // Shortcut with whitespace is rejected.
  assert.equal((await api('/api/me/quick-replies', {
    method: 'POST', token: a.token, body: { shortcut: 'no good', text: 'x' },
  })).status, 400);

  const qr = (await api('/api/me/quick-replies', {
    method: 'POST', token: a.token, body: { text: 'privat' },
  })).json.quickReply;
  // Eve can neither see nor touch Alice's quick reply.
  assert.equal((await api('/api/me/quick-replies', { token: eve.token })).json.quickReplies.length, 0);
  assert.equal((await api(`/api/me/quick-replies/${qr.id}`, { method: 'DELETE', token: eve.token })).status, 404);
  assert.equal((await api(`/api/me/quick-replies/${qr.id}`, { method: 'PATCH', token: eve.token, body: { text: 'hax' } })).status, 404);
});

// ---- Per-chat transcript export -------------------------------------------

test('export a chat as text and as json', async () => {
  const { a, b, chatId } = await fixture('30');
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: b.token, body: { body: 'antwort von bob' },
  });

  const txt = await api(`/api/chats/${chatId}/export?format=txt`, { token: a.token, raw: true });
  assert.equal(txt.status, 200);
  assert.match(txt.headers.get('content-type'), /text\/plain/);
  assert.match(txt.headers.get('content-disposition'), /attachment; filename=/);
  assert.match(txt.text, /Ping — Chatverlauf/);
  assert.match(txt.text, /hallo 30/);
  assert.match(txt.text, /antwort von bob/);
  assert.match(txt.text, /\bDu\b/, 'the requester is rendered as "Du"');

  const json = await api(`/api/chats/${chatId}/export?format=json`, { token: a.token, raw: true });
  assert.match(json.headers.get('content-type'), /application\/json/);
  const data = JSON.parse(json.text);
  assert.equal(data.messages.length, 2);
  assert.ok(Array.isArray(data.members) && data.members.length === 2);
});

test('non-members cannot export a chat', async () => {
  const { chatId } = await fixture('31');
  const mallory = await register('+491710003199', 'm31@e.com', 'Mallory');
  const r = await api(`/api/chats/${chatId}/export`, { token: mallory.token });
  assert.equal(r.status, 403);
});
