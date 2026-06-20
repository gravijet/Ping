// 0.27.0 "Ordnung & Ausdruck": pinned messages, saved/starred messages,
// server-synced drafts, chat folders and in-chat search.
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

// Two users with a direct chat and one message in it. Returns ids + tokens.
async function fixture(seq) {
  const a = await register(`+49170000${seq}0`, `a${seq}@e.com`, `A${seq}`);
  const b = await register(`+49170000${seq}1`, `b${seq}@e.com`, `B${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: `hello ${seq}` },
  });
  return { a, b, chatId, msgId: msg.json.message.id };
}

// ---- Pinned messages -------------------------------------------------------

test('pin/unpin a message and list pins; both members see it', async () => {
  const { a, b, chatId, msgId } = await fixture('20');

  const pin = await api(`/api/chats/${chatId}/messages/${msgId}/pin`, {
    method: 'POST', token: a.token,
  });
  assert.equal(pin.status, 200, JSON.stringify(pin.json));
  assert.equal(pin.json.count, 1);
  assert.equal(pin.json.message.pinned, true);

  // The other member sees the same pin (chat-wide).
  const pinsB = await api(`/api/chats/${chatId}/pins`, { token: b.token });
  assert.equal(pinsB.json.pins.length, 1);
  assert.equal(pinsB.json.pins[0].id, msgId);

  // pinnedCount surfaces on the chat list.
  const chats = await api('/api/chats', { token: b.token });
  const view = chats.json.chats.find((c) => c.id === chatId);
  assert.equal(view.pinnedCount, 1);

  const unpin = await api(`/api/chats/${chatId}/messages/${msgId}/pin`, {
    method: 'DELETE', token: b.token,
  });
  assert.equal(unpin.json.count, 0);
  const after = await api(`/api/chats/${chatId}/pins`, { token: a.token });
  assert.equal(after.json.pins.length, 0);
});

test('non-members cannot pin', async () => {
  const { chatId, msgId } = await fixture('21');
  const mallory = await register('+491700002199', 'm21@e.com', 'M');
  const r = await api(`/api/chats/${chatId}/messages/${msgId}/pin`, {
    method: 'POST', token: mallory.token,
  });
  assert.equal(r.status, 403);
});

test('pinning a non-existent message 404s', async () => {
  const { a, chatId } = await fixture('22');
  const r = await api(`/api/chats/${chatId}/messages/nope/pin`, {
    method: 'POST', token: a.token,
  });
  assert.equal(r.status, 404);
});

// ---- Saved / starred messages ---------------------------------------------

test('star toggles, syncs to messageView and /me/starred', async () => {
  const { a, chatId, msgId } = await fixture('23');

  const on = await api(`/api/chats/${chatId}/messages/${msgId}/star`, {
    method: 'POST', token: a.token,
  });
  assert.equal(on.json.starred, true);

  const saved = await api('/api/me/starred', { token: a.token });
  assert.equal(saved.json.messages.length, 1);
  assert.equal(saved.json.messages[0].id, msgId);
  assert.equal(saved.json.messages[0].starred, true);

  // Toggling again removes it.
  const off = await api(`/api/chats/${chatId}/messages/${msgId}/star`, {
    method: 'POST', token: a.token,
  });
  assert.equal(off.json.starred, false);
  const empty = await api('/api/me/starred', { token: a.token });
  assert.equal(empty.json.messages.length, 0);
});

test('stars are personal: the peer does not see my saved messages', async () => {
  const { a, b, chatId, msgId } = await fixture('24');
  await api(`/api/chats/${chatId}/messages/${msgId}/star`, {
    method: 'POST', token: a.token,
  });
  const peer = await api('/api/me/starred', { token: b.token });
  assert.equal(peer.json.messages.length, 0);
});

// ---- Server-synced drafts --------------------------------------------------

test('drafts save, appear on the chat view, and clear on empty', async () => {
  const { a, chatId } = await fixture('25');

  const put = await api(`/api/chats/${chatId}/draft`, {
    method: 'PUT', token: a.token, body: { text: 'half a thought' },
  });
  assert.equal(put.json.text, 'half a thought');

  const chats = await api('/api/chats', { token: a.token });
  const view = chats.json.chats.find((c) => c.id === chatId);
  assert.equal(view.draft, 'half a thought');

  // Whitespace clears it.
  await api(`/api/chats/${chatId}/draft`, {
    method: 'PUT', token: a.token, body: { text: '   ' },
  });
  const after = await api('/api/chats', { token: a.token });
  assert.equal(after.json.chats.find((c) => c.id === chatId).draft, '');
});

test('drafts are private to the author', async () => {
  const { a, b, chatId } = await fixture('26');
  await api(`/api/chats/${chatId}/draft`, {
    method: 'PUT', token: a.token, body: { text: 'secret' },
  });
  const chats = await api('/api/chats', { token: b.token });
  assert.equal(chats.json.chats.find((c) => c.id === chatId).draft, '');
});

// ---- Chat folders ----------------------------------------------------------

test('folder CRUD + chat assignment is scoped to the owner', async () => {
  const { a, chatId } = await fixture('27');

  const created = await api('/api/me/folders', {
    method: 'POST', token: a.token, body: { name: 'Arbeit', emoji: '💼' },
  });
  assert.equal(created.status, 201);
  const folderId = created.json.folder.id;
  assert.equal(created.json.folder.name, 'Arbeit');
  assert.deepEqual(created.json.folder.chatIds, []);

  const assign = await api(`/api/me/folders/${folderId}/chats`, {
    method: 'PUT', token: a.token, body: { chatIds: [chatId, 'not-mine'] },
  });
  // The bogus id is silently dropped; only the owned chat lands in the folder.
  assert.deepEqual(assign.json.folder.chatIds, [chatId]);

  const renamed = await api(`/api/me/folders/${folderId}`, {
    method: 'PATCH', token: a.token, body: { name: 'Beruf', emoji: '' },
  });
  assert.equal(renamed.json.folder.name, 'Beruf');

  const list = await api('/api/me/folders', { token: a.token });
  assert.equal(list.json.folders.length, 1);

  const del = await api(`/api/me/folders/${folderId}`, {
    method: 'DELETE', token: a.token,
  });
  assert.equal(del.status, 200);
  const empty = await api('/api/me/folders', { token: a.token });
  assert.equal(empty.json.folders.length, 0);
});

test('one user cannot touch another user folder', async () => {
  const { a } = await fixture('28');
  const eve = await register('+491700002899', 'eve28@e.com', 'Eve');
  const f = await api('/api/me/folders', {
    method: 'POST', token: a.token, body: { name: 'Privat' },
  });
  const folderId = f.json.folder.id;

  assert.equal(
    (await api(`/api/me/folders/${folderId}`, { method: 'DELETE', token: eve.token })).status,
    404
  );
  assert.equal(
    (await api(`/api/me/folders/${folderId}`, { method: 'PATCH', token: eve.token, body: { name: 'x' } })).status,
    404
  );
  // Eve's own list stays empty — she never saw A's folder.
  assert.equal((await api('/api/me/folders', { token: eve.token })).json.folders.length, 0);
});

test('rejects an empty folder name', async () => {
  const { a } = await fixture('29');
  const r = await api('/api/me/folders', {
    method: 'POST', token: a.token, body: { name: '   ' },
  });
  assert.equal(r.status, 400);
});

// ---- In-chat search --------------------------------------------------------

test('search can be scoped to a single chat', async () => {
  const a = await register('+491700003000', 'a30@e.com', 'A30');
  const b = await register('+491700003001', 'b30@e.com', 'B30');
  const c = await register('+491700003002', 'c30@e.com', 'C30');

  const chat1 = (await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  })).json.chat.id;
  const chat2 = (await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: c.user.phone },
  })).json.chat.id;

  await api(`/api/chats/${chat1}/messages`, {
    method: 'POST', token: a.token, body: { body: 'needle in chat one' },
  });
  await api(`/api/chats/${chat2}/messages`, {
    method: 'POST', token: a.token, body: { body: 'needle in chat two' },
  });

  const all = await api('/api/messages/search?q=needle', { token: a.token });
  assert.equal(all.json.messages.length, 2);

  const scoped = await api(`/api/messages/search?q=needle&chatId=${chat1}`, {
    token: a.token,
  });
  assert.equal(scoped.json.messages.length, 1);
  assert.equal(scoped.json.messages[0].chatId, chat1);
});
