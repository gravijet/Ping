// 0.37.0 "Feinschliff": HTTP-level coverage for the curated new features —
// send effects, poll quiz mode, recurring reminders (+ the maintenance reschedule),
// reaction details ("who reacted"), anniversaries, per-chat auto-translate, and
// smart-folder keyword rules. Mirrors the plaene.test.js harness.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');
const { runMaintenance } = await import('../src/maintenance.js');
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
  const a = await register(`+49173000${seq}0`, `fa${seq}@e.com`, `Alice${seq}`);
  const b = await register(`+49173000${seq}1`, `fb${seq}@e.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

// ---- sendEffects -----------------------------------------------------------

test('a message carries its send effect through to the view', async () => {
  const { a, chatId } = await fixture('20');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Tada!', effect: 'confetti' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.message.effect, 'confetti');

  // A plain message has no effect.
  const plain = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'hi' },
  });
  assert.equal(plain.json.message.effect, '');

  // An invalid effect value is rejected by the schema.
  const bad = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'x', effect: 'fireworks' },
  });
  assert.equal(bad.status, 400);
});

// ---- pollQuiz --------------------------------------------------------------

test('quiz poll hides the answer until the viewer votes, then reveals it', async () => {
  const { a, b, chatId } = await fixture('21');
  const created = await api(`/api/chats/${chatId}/polls`, {
    method: 'POST', token: a.token,
    body: { question: '2+2?', options: ['3', '4', '5'], correct: 1 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msgId = created.json.message.id;
  assert.equal(created.json.message.poll.quiz, true);
  // A quiz is single-choice regardless of any `multi`.
  assert.equal(created.json.message.poll.multi, false);

  // Bob hasn't voted yet → the correct answer is withheld.
  const before = await api(`/api/chats/${chatId}`, { token: b.token });
  // Fetch Bob's view of the message via history.
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const bView = hist.json.messages.find((m) => m.id === msgId);
  assert.equal(bView.poll.quiz, true);
  assert.equal(bView.poll.correct, null);

  // Bob votes (wrong answer) → the correct index is now revealed to him.
  const voted = await api(`/api/chats/${chatId}/messages/${msgId}/vote`, {
    method: 'POST', token: b.token, body: { option: 0 },
  });
  assert.equal(voted.status, 200, JSON.stringify(voted.json));
  assert.equal(voted.json.message.poll.correct, 1);
  void before;
});

// ---- recurringReminders ----------------------------------------------------

test('a daily reminder re-arms itself after the sweep fires it', async () => {
  const { a, chatId } = await fixture('22');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'remind me' },
  });
  const msgId = sent.json.message.id;

  // Due 5s ago (inside the schema's 60s past-skew tolerance) so the next sweep fires it.
  const created = await api(`/api/chats/${chatId}/messages/${msgId}/remind`, {
    method: 'POST', token: a.token,
    body: { remindAt: Date.now() - 5000, note: 'täglich', recur: 'daily' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.reminder.recur, 'daily');
  const firstAt = created.json.reminder.remindAt;

  await runMaintenance();

  // Still pending (not stamped fired) and advanced ~1 day into the future.
  const list = await api('/api/me/reminders', { token: a.token });
  const r = list.json.reminders.find((x) => x.id === created.json.reminder.id);
  assert.ok(r, 'recurring reminder should survive the sweep');
  assert.equal(r.firedAt, null);
  assert.ok(r.remindAt > Date.now(), 'should be re-armed into the future');
  assert.ok(r.remindAt >= firstAt + 86_400_000 - 1000, 'should advance ~1 day');
});

// ---- reactionDetails -------------------------------------------------------

test('reaction details list who reacted, grouped by emoji', async () => {
  const { a, b, chatId } = await fixture('23');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'nice' },
  });
  const msgId = sent.json.message.id;
  await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, {
    method: 'POST', token: a.token, body: { emoji: '👍' },
  });
  await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, {
    method: 'POST', token: b.token, body: { emoji: '👍' },
  });
  await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, {
    method: 'POST', token: b.token, body: { emoji: '🎉' },
  });

  const details = await api(`/api/chats/${chatId}/messages/${msgId}/reactions`, {
    token: b.token,
  });
  assert.equal(details.status, 200, JSON.stringify(details.json));
  const thumbs = details.json.reactions.find((g) => g.emoji === '👍');
  assert.equal(thumbs.users.length, 2);
  assert.ok(thumbs.users.every((u) => u.displayName));
  const party = details.json.reactions.find((g) => g.emoji === '🎉');
  assert.equal(party.users.length, 1);
});

// ---- anniversaries ---------------------------------------------------------

test('anniversaries surface a contact whose birthday is today', async () => {
  const { a, b, chatId } = await fixture('24');
  void chatId;
  // Give Bob a birthday of today (MM-DD), directly in the DB.
  const d = new Date();
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(mmdd, b.user.id);

  const res = await api('/api/me/anniversaries', { token: a.token });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const hit = res.json.anniversaries.find((x) => x.user.id === b.user.id);
  assert.ok(hit, 'Bob should appear in Alice\'s anniversaries');
  assert.equal(hit.inDays, 0);
});

// ---- autoTranslate ---------------------------------------------------------

test('per-chat auto-translate preference round-trips and is private', async () => {
  const { a, b, chatId } = await fixture('25');
  // Default: off.
  const initial = await api(`/api/chats/${chatId}/auto-translate`, { token: a.token });
  assert.equal(initial.json.lang, '');

  const set = await api(`/api/chats/${chatId}/auto-translate`, {
    method: 'POST', token: a.token, body: { lang: 'de' },
  });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.lang, 'de');

  const back = await api(`/api/chats/${chatId}/auto-translate`, { token: a.token });
  assert.equal(back.json.lang, 'de');

  // Bob's own preference in the same chat is independent (still off).
  const bobs = await api(`/api/chats/${chatId}/auto-translate`, { token: b.token });
  assert.equal(bobs.json.lang, '');

  // Clearing it works.
  const cleared = await api(`/api/chats/${chatId}/auto-translate`, {
    method: 'POST', token: a.token, body: { lang: '' },
  });
  assert.equal(cleared.json.lang, '');
});

// ---- smartFolders ----------------------------------------------------------

test('a folder keyword rule auto-collects matching chats', async () => {
  const { a, chatId } = await fixture('26');
  // The direct chat's title (for Alice) is Bob's display name, "Bob26".
  const folder = await api('/api/me/folders', {
    method: 'POST', token: a.token, body: { name: 'Bobs' },
  });
  assert.equal(folder.status, 201, JSON.stringify(folder.json));
  const folderId = folder.json.folder.id;

  const ruled = await api(`/api/me/folders/${folderId}/rule`, {
    method: 'PUT', token: a.token, body: { kind: 'keyword', keyword: 'Bob26' },
  });
  assert.equal(ruled.status, 200, JSON.stringify(ruled.json));
  const f = ruled.json.folders.find((x) => x.id === folderId);
  assert.deepEqual(f.rule, { kind: 'keyword', keyword: 'Bob26' });
  assert.ok(f.chatIds.includes(chatId), 'the matching direct chat is auto-included');

  // A non-matching keyword collects nothing.
  const ruled2 = await api(`/api/me/folders/${folderId}/rule`, {
    method: 'PUT', token: a.token, body: { kind: 'keyword', keyword: 'zzzznope' },
  });
  const f2 = ruled2.json.folders.find((x) => x.id === folderId);
  assert.ok(!f2.chatIds.includes(chatId));

  // Clearing the rule (kind 'all') removes it.
  const cleared = await api(`/api/me/folders/${folderId}/rule`, {
    method: 'PUT', token: a.token, body: { kind: 'all' },
  });
  const f3 = cleared.json.folders.find((x) => x.id === folderId);
  assert.equal(f3.rule, null);
});
