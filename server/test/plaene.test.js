// 0.33.0 "Pläne & Aufgaben": events with RSVP + reminders, and collaborative
// task lists (checklists). Full HTTP-level flow plus the maintenance sweep that
// fires due event reminders.
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

// A direct chat between two fresh users; both are members so both can RSVP / tick.
async function fixture(seq) {
  const a = await register(`+49172000${seq}0`, `a${seq}@e.com`, `Alice${seq}`);
  const b = await register(`+49172000${seq}1`, `b${seq}@e.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

// ---- Events (Termine) ------------------------------------------------------

test('create an event, RSVP from both sides, see live tallies', async () => {
  const { a, b, chatId } = await fixture('10');
  const startAt = Date.now() + 24 * 60 * 60 * 1000;

  const created = await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token,
    body: { title: 'Team-Lunch', location: 'Kantine', startAt, remindMinutes: 30 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msg = created.json.message;
  assert.equal(msg.type, 'event');
  assert.equal(msg.event.title, 'Team-Lunch');
  assert.equal(msg.event.location, 'Kantine');
  assert.equal(msg.event.startAt, startAt);
  assert.equal(msg.event.counts.going, 0);
  assert.equal(msg.event.myStatus, null);
  const msgId = msg.id;

  // Creator says going.
  const r1 = await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: a.token, body: { status: 'going' },
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.message.event.counts.going, 1);
  assert.equal(r1.json.message.event.myStatus, 'going');

  // Peer says maybe.
  const r2 = await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: b.token, body: { status: 'maybe' },
  });
  assert.equal(r2.json.message.event.counts.going, 1);
  assert.equal(r2.json.message.event.counts.maybe, 1);
  assert.equal(r2.json.message.event.myStatus, 'maybe');
  // Roster carries going + maybe attendees with names.
  assert.equal(r2.json.message.event.attendees.length, 2);

  // Peer changes mind → declined; maybe count drops back to 0.
  const r3 = await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: b.token, body: { status: 'declined' },
  });
  assert.equal(r3.json.message.event.counts.maybe, 0);
  assert.equal(r3.json.message.event.counts.declined, 1);

  // Withdraw entirely (null) → no RSVP rows remain for the peer.
  const r4 = await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: b.token, body: { status: null },
  });
  assert.equal(r4.json.message.event.counts.declined, 0);
  assert.equal(r4.json.message.event.myStatus, null);
});

test('an event in the past is rejected', async () => {
  const { a, chatId } = await fixture('11');
  const r = await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token,
    body: { title: 'Zu spät', startAt: Date.now() - 60 * 60 * 1000 },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('non-members cannot create an event or RSVP', async () => {
  const { a, chatId } = await fixture('12');
  const intruder = await register('+491720009990', 'intruder@e.com', 'Mallory');
  const created = await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token, body: { title: 'X', startAt: Date.now() + 3600_000 },
  });
  const msgId = created.json.message.id;
  const r = await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: intruder.token, body: { status: 'going' },
  });
  assert.equal(r.status, 403);
});

test('the agenda lists upcoming events across chats, sorted by start time', async () => {
  const { a, chatId } = await fixture('13');
  const soon = Date.now() + 2 * 3600_000;
  const later = Date.now() + 48 * 3600_000;
  await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token, body: { title: 'Später', startAt: later },
  });
  await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token, body: { title: 'Bald', startAt: soon },
  });
  const agenda = await api('/api/me/events', { token: a.token });
  assert.equal(agenda.status, 200);
  const titles = agenda.json.events.map((e) => e.title);
  assert.deepEqual(titles, ['Bald', 'Später'], 'sorted ascending by start');
  assert.ok(agenda.json.events[0].chatTitle, 'each event carries its chat title');
});

test('a due event reminder fires exactly once via the maintenance sweep', async () => {
  const { a, b, chatId } = await fixture('14');
  const startAt = Date.now() + 60 * 60 * 1000;
  const created = await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token,
    body: { title: 'Standup', startAt, remindMinutes: 30 },
  });
  const msgId = created.json.message.id;
  await api(`/api/chats/${chatId}/messages/${msgId}/rsvp`, {
    method: 'POST', token: b.token, body: { status: 'going' },
  });

  // Force the reminder due (the create path refuses to set a past remind_at).
  db.prepare('UPDATE events SET remind_at = ? WHERE message_id = ?').run(Date.now() - 1000, msgId);

  const first = runMaintenance();
  assert.equal(first.firedEvents, 1, 'reminder fires once');
  const second = runMaintenance();
  assert.equal(second.firedEvents, 0, 'and never again');
});

// ---- Task lists (Aufgaben) -------------------------------------------------

test('create a task list, tick items, add an item, watch progress', async () => {
  const { a, b, chatId } = await fixture('20');
  const created = await api(`/api/chats/${chatId}/tasklists`, {
    method: 'POST', token: a.token,
    body: { title: 'Einkauf', items: ['Milch', 'Brot', 'Eier'] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const tl = created.json.message.tasklist;
  assert.equal(created.json.message.type, 'tasklist');
  assert.equal(tl.title, 'Einkauf');
  assert.equal(tl.total, 3);
  assert.equal(tl.completed, 0);
  const msgId = created.json.message.id;
  const firstItem = tl.items[0].id;

  // Bob ticks the first item.
  const t1 = await api(`/api/chats/${chatId}/messages/${msgId}/tasks/${firstItem}/toggle`, {
    method: 'POST', token: b.token, body: { done: true },
  });
  assert.equal(t1.status, 200, JSON.stringify(t1.json));
  assert.equal(t1.json.message.tasklist.completed, 1);
  const ticked = t1.json.message.tasklist.items.find((i) => i.id === firstItem);
  assert.equal(ticked.done, true);
  assert.ok(ticked.doneByName.startsWith('Bob'), 'records who completed it');

  // Untick.
  const t2 = await api(`/api/chats/${chatId}/messages/${msgId}/tasks/${firstItem}/toggle`, {
    method: 'POST', token: a.token, body: { done: false },
  });
  assert.equal(t2.json.message.tasklist.completed, 0);

  // Add an item.
  const add = await api(`/api/chats/${chatId}/messages/${msgId}/tasks`, {
    method: 'POST', token: b.token, body: { text: 'Butter' },
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.message.tasklist.total, 4);
});

test('toggling a non-existent task item 404s', async () => {
  const { a, chatId } = await fixture('21');
  const created = await api(`/api/chats/${chatId}/tasklists`, {
    method: 'POST', token: a.token, body: { title: 'L', items: ['eins'] },
  });
  const msgId = created.json.message.id;
  const r = await api(`/api/chats/${chatId}/messages/${msgId}/tasks/nope/toggle`, {
    method: 'POST', token: a.token, body: { done: true },
  });
  assert.equal(r.status, 404);
});

test('a task list needs at least one item', async () => {
  const { a, chatId } = await fixture('22');
  const r = await api(`/api/chats/${chatId}/tasklists`, {
    method: 'POST', token: a.token, body: { title: 'Leer', items: [] },
  });
  assert.equal(r.status, 400);
});

// ---- Search integration ----------------------------------------------------

test('typ:termin and typ:aufgabe filters find structured messages', async () => {
  const { a, chatId } = await fixture('30');
  await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token,
    body: { title: 'Projekttreffen Roadmap', startAt: Date.now() + 3600_000 },
  });
  await api(`/api/chats/${chatId}/tasklists`, {
    method: 'POST', token: a.token, body: { title: 'Roadmap Aufgaben', items: ['planen'] },
  });
  const ev = await api('/api/messages/search?q=' + encodeURIComponent('typ:termin'), { token: a.token });
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.ok(ev.json.messages.some((m) => m.type === 'event'), 'finds the event');

  const tl = await api('/api/messages/search?q=' + encodeURIComponent('typ:aufgabe'), { token: a.token });
  assert.ok(tl.json.messages.some((m) => m.type === 'tasklist'), 'finds the task list');
});
