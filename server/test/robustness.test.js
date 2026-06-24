// Bug-fix campaign Phase 2: a single corrupt/legacy JSON column must never 500 a
// whole list endpoint. Before the safeJson() hardening, one bad `messages.attachment`
// (or `polls.options`) row took down the entire chat history fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';

const { createServer } = await import('../src/index.js');
const { db } = await import('../src/db.js');

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
  const a = await register(`+49173000${seq}0`, `ra${seq}@e.com`, `RAlice${seq}`);
  const b = await register(`+49173000${seq}1`, `rb${seq}@e.com`, `RBob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

test('corrupt messages.attachment does not crash the chat history fetch', async () => {
  const { a, chatId } = await fixture(1);
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'hallo' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  const msgId = sent.json.message.id;

  // Simulate a corrupt/legacy/truncated attachment column.
  db.prepare('UPDATE messages SET attachment = ? WHERE id = ?').run('{not valid json', msgId);

  const list = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  assert.equal(list.status, 200, 'history must still load, not 500');
  const m = list.json.messages.find((x) => x.id === msgId);
  assert.ok(m, 'the corrupt message is still returned');
  assert.equal(m.attachment, null, 'corrupt attachment degrades to null');
});

test('corrupt polls.options does not crash the chat history fetch', async () => {
  const { a, chatId } = await fixture(2);
  const poll = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token,
    body: { question: 'Pizza?', options: ['Ja', 'Nein'] },
  });
  assert.equal(poll.status, 201, JSON.stringify(poll.json));
  const msgId = poll.json.message.id;

  db.prepare('UPDATE polls SET options = ? WHERE message_id = ?').run('{broken', msgId);

  const list = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  assert.equal(list.status, 200, 'history must still load, not 500');
  const m = list.json.messages.find((x) => x.id === msgId);
  assert.ok(m, 'the poll message is still returned');
  assert.ok(m.poll, 'a poll payload is still attached');
  assert.deepEqual(m.poll.options, [], 'corrupt options degrade to an empty list');
});

test('a retried send with the same clientId is deduped, not duplicated', async () => {
  const { a, chatId } = await fixture(4);
  const send = () =>
    api(`/api/chats/${chatId}/messages`, {
      method: 'POST', token: a.token, body: { body: 'nur einmal', clientId: 'fixed-key-1' },
    });
  const first = await send();
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await send(); // same clientId — a retry
  assert.equal(second.status, 201);
  // Same canonical message id both times → the server collapsed the retry.
  assert.equal(second.json.message.id, first.json.message.id, 'retry must reuse the message');

  // And the chat really holds only one copy.
  const list = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  const copies = list.json.messages.filter((m) => m.body === 'nur einmal');
  assert.equal(copies.length, 1, 'exactly one message stored');
});

test('different clientIds create distinct messages', async () => {
  const { a, chatId } = await fixture(5);
  const r1 = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'A', clientId: 'k-a' },
  });
  const r2 = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'B', clientId: 'k-b' },
  });
  assert.notEqual(r2.json.message.id, r1.json.message.id);
});

test('voting on a poll with corrupt options is rejected, not a crash', async () => {
  const { a, chatId } = await fixture(3);
  const poll = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token,
    body: { question: 'Eis?', options: ['Vanille', 'Schoko'] },
  });
  const msgId = poll.json.message.id;
  db.prepare('UPDATE polls SET options = ? WHERE message_id = ?').run('nonsense', msgId);

  const vote = await api(`/api/chats/${chatId}/messages/${msgId}/vote`, {
    method: 'POST', token: a.token, body: { option: 0 },
  });
  // The vote can't land (no valid options) but the server must not 500.
  assert.notEqual(vote.status, 500, 'a corrupt poll vote must not 500');
});
