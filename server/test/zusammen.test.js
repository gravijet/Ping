// 0.36.0 "Zusammen": shared expenses (Geteilte Kasse) with a balancing ledger +
// one-tap settle-up, and availability polls (Terminfindung) that lock into a real
// event. Full HTTP-level flow.
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
  const a = await register(`+49173000${seq}0`, `a${seq}@z.com`, `Alice${seq}`);
  const b = await register(`+49173000${seq}1`, `b${seq}@z.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

// ---- Shared expenses (Geteilte Kasse) -------------------------------------

test('equal-split expense balances the ledger and the share splits evenly', async () => {
  const { a, b, chatId } = await fixture('10');
  const created = await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Pizza', amountCents: 2400, currency: 'EUR',
      split: 'equal', participants: [a.user.id, b.user.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const ex = created.json.message.expense;
  assert.equal(created.json.message.type, 'expense');
  assert.equal(ex.amountCents, 2400);
  assert.equal(ex.payerId, a.user.id);
  assert.equal(ex.iPaid, true);
  assert.equal(ex.myShare, 1200, 'payer owes their half');
  assert.equal(ex.shares.length, 2);

  // Bob sees the same expense but owes his half and did not pay.
  const asB = await api(`/api/chats/${chatId}/ledger`, { token: b.token });
  assert.equal(asB.status, 200);
  const g = asB.json.ledger.find((x) => x.currency === 'EUR');
  const balA = g.balances.find((x) => x.userId === a.user.id);
  const balB = g.balances.find((x) => x.userId === b.user.id);
  assert.equal(balA.net, 1200, 'Alice is owed her half back');
  assert.equal(balB.net, -1200, 'Bob owes his half');
  assert.equal(g.totalSpent, 2400);
  // Minimal settle-up: Bob → Alice 1200.
  assert.equal(g.settlements.length, 1);
  assert.deepEqual(
    { from: g.settlements[0].from, to: g.settlements[0].to, amount: g.settlements[0].amount },
    { from: b.user.id, to: a.user.id, amount: 1200 },
  );
});

test('an odd amount distributes the remainder cent so shares sum to the total', async () => {
  const { a, b, chatId } = await fixture('11');
  const created = await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Taxi', amountCents: 2401, split: 'equal',
      participants: [a.user.id, b.user.id] },
  });
  const shares = created.json.message.expense.shares;
  const sum = shares.reduce((n, s) => n + s.shareCents, 0);
  assert.equal(sum, 2401, 'shares always re-sum to the total');
  assert.deepEqual(shares.map((s) => s.shareCents).sort(), [1200, 1201]);
});

test('a custom split must sum to the total', async () => {
  const { a, b, chatId } = await fixture('12');
  const bad = await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Geschenk', amountCents: 3000, split: 'custom',
      shares: [{ userId: a.user.id, shareCents: 1000 }, { userId: b.user.id, shareCents: 1500 }] },
  });
  assert.equal(bad.status, 400, 'rejects a split that does not add up');

  const ok = await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Geschenk', amountCents: 3000, split: 'custom',
      shares: [{ userId: a.user.id, shareCents: 1000 }, { userId: b.user.id, shareCents: 2000 }] },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
});

test('settling up posts a settlement and zeroes the balance', async () => {
  const { a, b, chatId } = await fixture('13');
  await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Bahn', amountCents: 1000, split: 'equal',
      participants: [a.user.id, b.user.id] },
  });
  // Bob owes 500; he settles up with Alice.
  const settle = await api(`/api/chats/${chatId}/ledger/settle`, {
    method: 'POST', token: b.token,
    body: { toUserId: a.user.id, amountCents: 500, currency: 'EUR' },
  });
  assert.equal(settle.status, 201, JSON.stringify(settle.json));
  assert.equal(settle.json.message.expense.kind, 'settlement');

  const ledger = await api(`/api/chats/${chatId}/ledger`, { token: a.token });
  const g = ledger.json.ledger.find((x) => x.currency === 'EUR');
  // Everyone is square now → no settle-up suggestions remain.
  assert.equal(g.settlements.length, 0, 'all settled');
  assert.ok(g.balances.every((x) => x.net === 0), 'every balance is zero');
});

test('the cross-chat overview lists chats where you owe or are owed', async () => {
  const { a, b, chatId } = await fixture('14');
  await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Kino', amountCents: 2000, split: 'equal',
      participants: [a.user.id, b.user.id] },
  });
  const me = await api('/api/me/ledger', { token: b.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.entries.length, 1);
  assert.equal(me.json.entries[0].net, -1000, 'Bob owes 1000');
  assert.ok(me.json.entries[0].chatTitle, 'entry carries the chat title');
});

test('non-members cannot add an expense or read the ledger', async () => {
  const { a, chatId } = await fixture('15');
  const intruder = await register('+491730009990', 'introoz@z.com', 'Mallory');
  const add = await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: intruder.token,
    body: { title: 'X', amountCents: 100, split: 'equal', participants: [a.user.id] },
  });
  assert.equal(add.status, 403);
  const ledger = await api(`/api/chats/${chatId}/ledger`, { token: intruder.token });
  assert.equal(ledger.status, 403);
});

// ---- Availability polls (Terminfindung) -----------------------------------

test('availability poll: vote per slot, then organiser locks → spawns an event', async () => {
  const { a, b, chatId } = await fixture('20');
  const t1 = Date.now() + 24 * 3600_000;
  const t2 = Date.now() + 48 * 3600_000;
  const created = await api(`/api/chats/${chatId}/availpolls`, {
    method: 'POST', token: a.token,
    body: { title: 'Spieleabend', location: 'bei Anna', options: [t1, t2] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const ap = created.json.message.availpoll;
  assert.equal(created.json.message.type, 'availpoll');
  assert.equal(ap.options.length, 2);
  assert.equal(ap.closed, false);
  const msgId = created.json.message.id;
  const [opt1, opt2] = ap.options;

  // Both vote 'yes' on slot 1; Bob is 'no' on slot 2.
  const v1 = await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/vote`, {
    method: 'POST', token: a.token, body: { optionId: opt1.id, vote: 'yes' },
  });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/vote`, {
    method: 'POST', token: b.token, body: { optionId: opt1.id, vote: 'yes' },
  });
  const v3 = await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/vote`, {
    method: 'POST', token: b.token, body: { optionId: opt2.id, vote: 'no' },
  });
  const after = v3.json.message.availpoll;
  assert.equal(after.options.find((o) => o.id === opt1.id).counts.yes, 2);
  assert.equal(after.bestOptionId, opt1.id, 'slot 1 is the front-runner');

  // A non-organiser cannot lock.
  const denied = await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/lock`, {
    method: 'POST', token: b.token, body: { optionId: opt1.id },
  });
  assert.equal(denied.status, 403);

  // Organiser locks slot 1 → poll closes and a real event message is born.
  const locked = await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/lock`, {
    method: 'POST', token: a.token, body: { optionId: opt1.id, remindMinutes: 30 },
  });
  assert.equal(locked.status, 201, JSON.stringify(locked.json));
  assert.equal(locked.json.poll.availpoll.closed, true);
  assert.equal(locked.json.poll.availpoll.chosenOptionId, opt1.id);
  assert.equal(locked.json.event.type, 'event');
  assert.equal(locked.json.event.event.title, 'Spieleabend');
  assert.equal(locked.json.event.event.location, 'bei Anna');
  assert.equal(locked.json.event.event.startAt, opt1.startAt);

  // Voting on a closed poll is refused.
  const late = await api(`/api/chats/${chatId}/messages/${msgId}/availpoll/vote`, {
    method: 'POST', token: b.token, body: { optionId: opt2.id, vote: 'yes' },
  });
  assert.equal(late.status, 400);

  // The spawned event shows up in the cross-chat agenda.
  const agenda = await api('/api/me/events', { token: a.token });
  assert.ok(agenda.json.events.some((e) => e.title === 'Spieleabend'));
});

test('an availability poll needs at least two slots', async () => {
  const { a, chatId } = await fixture('21');
  const r = await api(`/api/chats/${chatId}/availpolls`, {
    method: 'POST', token: a.token,
    body: { title: 'Zu wenig', options: [Date.now() + 3600_000] },
  });
  assert.equal(r.status, 400);
});

// ---- Search integration ----------------------------------------------------

test('typ:kasse and typ:terminfindung filters find the new types', async () => {
  const { a, b, chatId } = await fixture('30');
  await api(`/api/chats/${chatId}/expenses`, {
    method: 'POST', token: a.token,
    body: { title: 'Brunch', amountCents: 1800, split: 'equal',
      participants: [a.user.id, b.user.id] },
  });
  await api(`/api/chats/${chatId}/availpolls`, {
    method: 'POST', token: a.token,
    body: { title: 'Wandern', options: [Date.now() + 3600_000, Date.now() + 7200_000] },
  });
  const ex = await api('/api/messages/search?q=' + encodeURIComponent('typ:kasse'), { token: a.token });
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  assert.ok(ex.json.messages.some((m) => m.type === 'expense'), 'finds the expense');

  const ap = await api('/api/messages/search?q=' + encodeURIComponent('typ:terminfindung'), { token: a.token });
  assert.ok(ap.json.messages.some((m) => m.type === 'availpoll'), 'finds the availability poll');
});
