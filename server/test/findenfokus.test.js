// 0.30.0 "Finden & Fokus": FTS5 full-text message search (with filter
// operators) and a server-enforced focus mode / quiet hours with DM auto-reply.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');
const { ftsAvailable } = await import('../src/db.js');
const { parseSearchQuery } = await import('../src/chatRepo.js');
const {
  setFocus,
  getFocus,
  isUserSilenced,
  inQuietHours,
  filterAudible,
} = await import('../src/focusRepo.js');

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

async function directChat(a, b) {
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return chat.json.chat.id;
}

const send = (token, chatId, body) =>
  api(`/api/chats/${chatId}/messages`, { method: 'POST', token, body: { body } });

const search = (token, q, extra = '') =>
  api(`/api/messages/search?q=${encodeURIComponent(q)}${extra}`, { token });

// ---- Query parsing (pure) --------------------------------------------------

test('parseSearchQuery splits free text from filter operators (de + en)', () => {
  const p = parseSearchQuery('von:anna typ:foto nach:2026-01-01 urlaub berge');
  assert.equal(p.from, 'anna');
  assert.equal(p.type, 'image');
  assert.equal(p.text, 'urlaub berge');
  assert.ok(p.after > 0);
  assert.equal(p.before, null);

  const en = parseSearchQuery('from:bob type:file before:2026-12-31 vertrag');
  assert.equal(en.from, 'bob');
  assert.equal(en.type, 'file');
  assert.ok(en.before > 0);
  assert.equal(en.text, 'vertrag');

  // Unknown operator stays literal text; bad date is ignored as a filter.
  const lit = parseSearchQuery('foo:bar nach:nope hallo');
  assert.equal(lit.after, null);
  assert.ok(lit.text.includes('foo:bar'));
  assert.ok(lit.text.includes('hallo'));
});

// ---- Full-text search ------------------------------------------------------

test('global search finds a message by word, with prefix matching', async () => {
  const a = await register('+49171010000', 'fa@e.com', 'AliceS');
  const b = await register('+49171010001', 'fb@e.com', 'BobS');
  const chatId = await directChat(a, b);
  await send(a.token, chatId, 'Ich bringe Apfelkuchen zur Feier mit');
  await send(b.token, chatId, 'Klingt lecker, danke!');

  // Prefix match: "apfel" → "Apfelkuchen".
  const r = await search(a.token, 'apfel');
  assert.equal(r.status, 200);
  assert.equal(r.json.messages.length, 1, JSON.stringify(r.json.messages));
  const hit = r.json.messages[0];
  assert.match(hit.body, /Apfelkuchen/);
  assert.equal(hit.chatId, chatId);
  assert.equal(hit.senderName, 'AliceS');
  assert.ok(hit.chatTitle, 'result carries chat context');
  if (ftsAvailable) assert.ok(typeof hit.snippet === 'string', 'FTS path attaches a snippet');
});

test('search filters: von: (sender), typ:, and chat scope', async () => {
  const a = await register('+49171010010', 'fa2@e.com', 'Quincy');
  const b = await register('+49171010011', 'fb2@e.com', 'Wanda');
  const chatId = await directChat(a, b);
  await send(a.token, chatId, 'Projektplan finalisieren bitte');
  await send(b.token, chatId, 'Projektplan sieht gut aus');

  // Free text matches both messages…
  const both = await search(a.token, 'projektplan');
  assert.equal(both.json.messages.length, 2);

  // …but von:Wanda narrows to Wanda's message.
  const byWanda = await search(a.token, 'von:Wanda projektplan');
  assert.equal(byWanda.json.messages.length, 1);
  assert.equal(byWanda.json.messages[0].senderName, 'Wanda');

  // typ:text matches text messages; typ:image matches none here.
  assert.equal((await search(a.token, 'typ:text projektplan')).json.messages.length, 2);
  assert.equal((await search(a.token, 'typ:image projektplan')).json.messages.length, 0);

  // chatId scope only returns hits from that chat (membership enforced).
  const scoped = await search(a.token, 'projektplan', `&chatId=${chatId}`);
  assert.equal(scoped.json.messages.length, 2);
});

test('search only spans chats the user belongs to, and skips deleted messages', async () => {
  const a = await register('+49171010020', 'fa3@e.com', 'Eaves');
  const b = await register('+49171010021', 'fb3@e.com', 'Frank');
  const outsider = await register('+49171010022', 'fc3@e.com', 'Olivia');
  const chatId = await directChat(a, b);
  const m = await send(a.token, chatId, 'Geheimnis Wassermelone');

  // The outsider is not a member, so the term is invisible to them.
  assert.equal((await search(outsider.token, 'wassermelone')).json.messages.length, 0);
  // Members can find it.
  assert.equal((await search(b.token, 'wassermelone')).json.messages.length, 1);

  // Deleting the message removes it from the index (trigger-maintained / LIKE both).
  const del = await api(`/api/chats/${chatId}/messages/${m.json.message.id}`, {
    method: 'DELETE', token: a.token,
  });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await search(a.token, 'wassermelone')).json.messages.length, 0);
});

// ---- Focus mode & quiet hours ----------------------------------------------

test('GET /me/focus returns defaults; PUT persists and echoes', async () => {
  const a = await register('+49171010030', 'foc1@e.com', 'Greta');
  const def = await api('/api/me/focus', { token: a.token });
  assert.equal(def.status, 200);
  assert.equal(def.json.focus.focusActive, false);
  assert.equal(def.json.focus.quietEnabled, false);

  const put = await api('/api/me/focus', {
    method: 'PUT', token: a.token,
    body: { quietEnabled: true, quietStart: 22 * 60, quietEnd: 7 * 60, autoReply: 'Schlafe 😴' },
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.focus.quietEnabled, true);
  assert.equal(put.json.focus.autoReply, 'Schlafe 😴');

  // Round-trips and untouched fields persist.
  const got = await api('/api/me/focus', { token: a.token });
  assert.equal(got.json.focus.quietStart, 22 * 60);
  assert.equal(got.json.focus.quietEnd, 7 * 60);
});

test('isUserSilenced honours manual focus and a quiet-hours window (incl. midnight)', async () => {
  const a = await register('+49171010040', 'foc2@e.com', 'Hanna');
  const uid = a.user.id;

  // Manual focus into the future silences; an expired one does not.
  setFocus(uid, { focusUntil: Date.now() + 60_000 });
  assert.equal(isUserSilenced(uid), true);
  setFocus(uid, { focusUntil: Date.now() - 1 });
  assert.equal(isUserSilenced(uid), false);

  // Build a quiet window that brackets "now" in local time → silenced.
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  setFocus(uid, {
    quietEnabled: true,
    quietStart: (cur - 30 + 1440) % 1440,
    quietEnd: (cur + 30) % 1440,
    quietDays: 127,
  });
  // Only assert when the window doesn't span a midnight edge case for "now".
  assert.equal(inQuietHours(getFocus(uid)), true);

  // A window safely in the past (and not wrapping onto now) → not silenced.
  setFocus(uid, {
    quietEnabled: true,
    quietStart: (cur + 60) % 1440,
    quietEnd: (cur + 120) % 1440,
    quietDays: 127,
  });
  assert.equal(inQuietHours(getFocus(uid)), false);

  // Disabling quiet hours clears it regardless of the window.
  setFocus(uid, { quietEnabled: false });
  assert.equal(isUserSilenced(uid), false);
});

test('filterAudible drops silenced users only', async () => {
  const a = await register('+49171010050', 'foc3@e.com', 'Ida');
  const b = await register('+49171010051', 'foc4@e.com', 'Jonas');
  setFocus(a.user.id, { focusUntil: Date.now() + 60_000 });
  setFocus(b.user.id, { focusUntil: 0, quietEnabled: false });
  const audible = filterAudible([a.user.id, b.user.id]);
  assert.deepEqual(audible, [b.user.id]);
});

test('a DM to a focused user triggers one auto-reply, throttled thereafter', async () => {
  const a = await register('+49171010060', 'ar1@e.com', 'Klaus');
  const b = await register('+49171010061', 'ar2@e.com', 'Lena');
  const chatId = await directChat(a, b);

  // Lena turns on focus with an auto-reply.
  await api('/api/me/focus', {
    method: 'PUT', token: b.token,
    body: { focusUntil: Date.now() + 3600_000, autoReply: 'Bin gerade im Fokus, melde mich später.' },
  });

  const count = async () =>
    (await api(`/api/chats/${chatId}/messages?limit=100`, { token: a.token })).json.messages.length;

  // First inbound DM → Lena's canned reply appears in the conversation.
  await send(a.token, chatId, 'Hast du kurz Zeit?');
  let msgs = (await api(`/api/chats/${chatId}/messages?limit=100`, { token: a.token })).json.messages;
  const auto = msgs.find((m) => m.senderId === b.user.id && /im Fokus/.test(m.body));
  assert.ok(auto, 'an auto-reply from Lena was delivered');
  const afterFirst = msgs.length;

  // Second inbound DM within the cool-down → no further auto-reply.
  await send(a.token, chatId, 'Bitte melde dich');
  const afterSecond = await count();
  assert.equal(afterSecond, afterFirst + 1, 'only the new inbound message, no second auto-reply');
});

test('auto-reply never fires in group chats', async () => {
  const a = await register('+49171010070', 'arg1@e.com', 'Mara');
  const b = await register('+49171010071', 'arg2@e.com', 'Nico');
  const grp = await api('/api/chats/group', {
    method: 'POST', token: a.token,
    body: { name: 'Crew', memberIds: [b.user.id] },
  });
  assert.equal(grp.status, 201, JSON.stringify(grp.json));
  const chatId = grp.json.chat.id;

  await api('/api/me/focus', {
    method: 'PUT', token: b.token,
    body: { focusUntil: Date.now() + 3600_000, autoReply: 'group autoreply should not send' },
  });
  const before = (await api(`/api/chats/${chatId}/messages?limit=100`, { token: a.token })).json.messages.length;
  await send(a.token, chatId, 'Hallo Team');
  const after = (await api(`/api/chats/${chatId}/messages?limit=100`, { token: a.token })).json.messages;
  assert.ok(!after.some((m) => /group autoreply/.test(m.body)), 'no auto-reply in groups');
  assert.equal(after.length, before + 1);
});
