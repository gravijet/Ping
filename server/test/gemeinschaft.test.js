// 0.31.0 "Gemeinschaft": public, discoverable broadcast channels (Communities).
// Covers creation + handle uniqueness/validation, the directory (search +
// category filter), handle deep-link lookup, join (idempotent), the broadcast
// posting gate (only owners post; subscribers read + react) and owner-only edit.
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

let seq = 600;
async function user(name) {
  seq += 1;
  const r = await register(`+4915${seq}00000`, `u${seq}@e.com`, name);
  return r;
}

// ---- Creation --------------------------------------------------------------

test('create a channel: owner gets a broadcast chat with a handle', async () => {
  const owner = await user('Owner');
  const r = await api('/api/channels', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Ping News', handle: 'ping-news', description: 'Updates', category: 'Nachrichten' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const chat = r.json.chat;
  assert.equal(chat.isChannel, true);
  assert.equal(chat.broadcast, true);
  assert.equal(chat.visibility, 'public');
  assert.equal(chat.handle, 'ping-news');
  assert.equal(chat.role, 'owner');
  assert.equal(chat.canPost, true); // owner may post
  assert.equal(chat.subscriberCount, 1);
});

test('handle must be unique (case-insensitive) → 409', async () => {
  const a = await user('A');
  const b = await user('B');
  const first = await api('/api/channels', {
    method: 'POST', token: a.token, body: { name: 'Dupe', handle: 'dupe-chan' },
  });
  assert.equal(first.status, 201);
  const clash = await api('/api/channels', {
    method: 'POST', token: b.token, body: { name: 'Dupe 2', handle: 'DUPE-CHAN' },
  });
  assert.equal(clash.status, 409, JSON.stringify(clash.json));
});

test('invalid handles are rejected with 400', async () => {
  const a = await user('A');
  for (const handle of ['ab', 'has spaces', '-leading', 'Trailing-', 'no!chars']) {
    const r = await api('/api/channels', {
      method: 'POST', token: a.token, body: { name: 'X', handle },
    });
    assert.equal(r.status, 400, `expected 400 for "${handle}" → ${JSON.stringify(r.json)}`);
  }
});

// ---- Directory -------------------------------------------------------------

test('directory lists public channels, supports search + category filter', async () => {
  const a = await user('A');
  await api('/api/channels', {
    method: 'POST', token: a.token,
    body: { name: 'Astro Daily', handle: 'astro-daily', description: 'space stuff', category: 'Bildung' },
  });
  await api('/api/channels', {
    method: 'POST', token: a.token,
    body: { name: 'Kick Off', handle: 'kick-off', description: 'football', category: 'Sport' },
  });

  const all = await api('/api/channels', { token: a.token });
  assert.equal(all.status, 200);
  const handles = all.json.channels.map((c) => c.handle);
  assert.ok(handles.includes('astro-daily') && handles.includes('kick-off'));
  // The card carries the viewer's joined state + a subscriber count.
  const astro = all.json.channels.find((c) => c.handle === 'astro-daily');
  assert.equal(astro.joined, true); // creator is a member
  assert.equal(typeof astro.subscriberCount, 'number');

  const q = await api('/api/channels?q=football', { token: a.token });
  assert.deepEqual(q.json.channels.map((c) => c.handle), ['kick-off']);

  const sport = await api('/api/channels?category=Sport', { token: a.token });
  assert.ok(sport.json.channels.every((c) => c.category === 'Sport'));
  assert.ok(sport.json.channels.some((c) => c.handle === 'kick-off'));
});

// ---- Handle lookup + join --------------------------------------------------

test('lookup by handle, join (idempotent), and subscriber count ticks', async () => {
  const owner = await user('Owner');
  const fan = await user('Fan');
  await api('/api/channels', {
    method: 'POST', token: owner.token,
    body: { name: 'Tech Talk', handle: 'tech-talk', category: 'Technik' },
  });

  const preview = await api('/api/channels/tech-talk', { token: fan.token });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.channel.handle, 'tech-talk');
  assert.equal(preview.json.channel.joined, false);
  assert.equal(preview.json.channel.owner.displayName, 'Owner');
  assert.equal(preview.json.channel.subscriberCount, 1);

  const join = await api('/api/channels/tech-talk/join', { method: 'POST', token: fan.token });
  assert.equal(join.status, 201, JSON.stringify(join.json));
  assert.equal(join.json.joined, true);
  assert.equal(join.json.chat.canPost, false); // a subscriber cannot post

  // Re-joining is a no-op (idempotent).
  const again = await api('/api/channels/tech-talk/join', { method: 'POST', token: fan.token });
  assert.equal(again.json.joined, false);

  const after = await api('/api/channels/tech-talk', { token: fan.token });
  assert.equal(after.json.channel.subscriberCount, 2);

  const unknown = await api('/api/channels/does-not-exist', { token: fan.token });
  assert.equal(unknown.status, 404);
});

// ---- Broadcast posting gate ------------------------------------------------

test('only the owner may post; a subscriber may read + react', async () => {
  const owner = await user('Owner');
  const fan = await user('Fan');
  const created = await api('/api/channels', {
    method: 'POST', token: owner.token, body: { name: 'Feed', handle: 'the-feed' },
  });
  const chatId = created.json.chat.id;
  await api('/api/channels/the-feed/join', { method: 'POST', token: fan.token });

  // Owner posts.
  const post = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: owner.token, body: { body: 'Welcome to the feed!' },
  });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  const msgId = post.json.message.id;

  // Subscriber cannot post.
  const blocked = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: fan.token, body: { body: 'can I post?' },
  });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));

  // …but can read the history.
  const history = await api(`/api/chats/${chatId}/messages`, { token: fan.token });
  assert.equal(history.status, 200);
  assert.ok(history.json.messages.some((m) => m.id === msgId));

  // …and react to the owner's post.
  const react = await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, {
    method: 'POST', token: fan.token, body: { emoji: '🔥' },
  });
  assert.equal(react.status, 200, JSON.stringify(react.json));
  assert.equal(react.json.message.reactions['🔥'], 1);
});

// ---- Owner-only edit -------------------------------------------------------

test('owner can edit channel meta; a subscriber cannot', async () => {
  const owner = await user('Owner');
  const fan = await user('Fan');
  const created = await api('/api/channels', {
    method: 'POST', token: owner.token, body: { name: 'Old Name', handle: 'edit-me', category: 'Community' },
  });
  const chatId = created.json.chat.id;
  await api('/api/channels/edit-me/join', { method: 'POST', token: fan.token });

  const denied = await api(`/api/channels/${chatId}`, {
    method: 'PATCH', token: fan.token, body: { name: 'Hijacked' },
  });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));

  const ok = await api(`/api/channels/${chatId}`, {
    method: 'PATCH', token: owner.token,
    body: { name: 'New Name', description: 'fresh', category: 'Technik' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.chat.title, 'New Name');
  assert.equal(ok.json.chat.description, 'fresh');
  assert.equal(ok.json.chat.category, 'Technik');

  // PATCH on a non-channel group is refused.
  const grp = await api('/api/chats/group', {
    method: 'POST', token: owner.token, body: { name: 'Plain Group' },
  });
  const notChannel = await api(`/api/channels/${grp.json.chat.id}`, {
    method: 'PATCH', token: owner.token, body: { name: 'x' },
  });
  assert.equal(notChannel.status, 400, JSON.stringify(notChannel.json));
});
