// 0.35.0 "Ausdruck & Werkbank": contact cards (type='contact') and code
// snippets (type='code'). Full HTTP-level flow — create, payload shape,
// validation, member-guarding, and timeline round-trip.
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

async function register(phone, email, name) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName: name, password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

async function fixture(seq) {
  const a = await register(`+49173000${seq}0`, `a${seq}@e.com`, `Alice${seq}`);
  const b = await register(`+49173000${seq}1`, `b${seq}@e.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

// ---- Contact cards ---------------------------------------------------------

test('share a contact card → snapshot + live link to the account', async () => {
  const { a, b, chatId } = await fixture('20');

  const created = await api(`/api/chats/${chatId}/contact`, {
    method: 'POST', token: a.token,
    body: { userId: b.user.id, note: 'Meine Kollegin' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msg = created.json.message;
  assert.equal(msg.type, 'contact');
  assert.ok(msg.contact, 'contact payload present');
  assert.equal(msg.contact.userId, b.user.id);
  assert.equal(msg.contact.isUser, true);
  assert.equal(msg.contact.displayName, b.user.displayName);
  assert.equal(msg.contact.note, 'Meine Kollegin');

  // The recipient sees the same card on a fresh timeline fetch.
  const timeline = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.equal(timeline.status, 200);
  const card = timeline.json.messages.find((m) => m.id === msg.id);
  assert.ok(card, 'card is in the timeline');
  assert.equal(card.contact.displayName, b.user.displayName);
});

test('contact card freshens from the live profile (rename is reflected)', async () => {
  const { a, b, chatId } = await fixture('21');
  const created = await api(`/api/chats/${chatId}/contact`, {
    method: 'POST', token: a.token, body: { userId: b.user.id },
  });
  const msgId = created.json.message.id;

  // Bob renames himself; the already-sent card should pick up the new name.
  const upd = await api('/api/me', { method: 'PATCH', token: b.token, body: { displayName: 'Bob Neu' } });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));

  const timeline = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  const card = timeline.json.messages.find((m) => m.id === msgId);
  assert.equal(card.contact.displayName, 'Bob Neu');
});

test('sharing a non-existent user is rejected', async () => {
  const { a, chatId } = await fixture('22');
  const r = await api(`/api/chats/${chatId}/contact`, {
    method: 'POST', token: a.token, body: { userId: 'nope-nope-nope' },
  });
  assert.equal(r.status, 404, JSON.stringify(r.json));
});

test('a non-member cannot post a contact card into the chat', async () => {
  const { a, chatId } = await fixture('23');
  const c = await register('+491730009990', 'cc@e.com', 'Carol');
  const r = await api(`/api/chats/${chatId}/contact`, {
    method: 'POST', token: c.token, body: { userId: a.user.id },
  });
  assert.equal(r.status, 403, JSON.stringify(r.json));
});

// ---- Code snippets ---------------------------------------------------------

test('share a code snippet → source preserved, body is a tidy teaser', async () => {
  const { a, b, chatId } = await fixture('30');
  const code = "function add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));";

  const created = await api(`/api/chats/${chatId}/code`, {
    method: 'POST', token: a.token,
    body: { code, language: 'JavaScript', filename: 'add.js' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msg = created.json.message;
  assert.equal(msg.type, 'code');
  assert.equal(msg.code.code, code, 'full source travels in the payload');
  assert.equal(msg.code.lines, 4);
  assert.equal(msg.code.language, 'javascript', 'language is normalised lower-case');
  assert.equal(msg.code.filename, 'add.js');
  // The body stays a short teaser so push previews never dump a wall of code.
  assert.ok(!msg.body.includes('function'), 'body is a teaser, not the source');
  assert.match(msg.body, /Zeilen/);

  // Round-trips to the recipient.
  const timeline = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const got = timeline.json.messages.find((m) => m.id === msg.id);
  assert.equal(got.code.code, code);
});

test('empty code is rejected', async () => {
  const { a, chatId } = await fixture('31');
  const r = await api(`/api/chats/${chatId}/code`, {
    method: 'POST', token: a.token, body: { code: '   \n  ' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('an oversized snippet is rejected', async () => {
  const { a, chatId } = await fixture('32');
  const r = await api(`/api/chats/${chatId}/code`, {
    method: 'POST', token: a.token, body: { code: 'x'.repeat(20001) },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('a code snippet with no language label still works', async () => {
  const { a, chatId } = await fixture('33');
  const r = await api(`/api/chats/${chatId}/code`, {
    method: 'POST', token: a.token, body: { code: 'just text' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.message.code.language, '');
  assert.equal(r.json.message.code.lines, 1);
});
