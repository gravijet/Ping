// 0.34.0 "Alles" — Wave A (threads, live location, scheduled calls) plus the new
// structured message types (boards, games). Full HTTP-level flow + the
// maintenance sweep that fires scheduled-call reminders.
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
  const a = await register(`+49173000${seq}0`, `a${seq}@x.com`, `Alice${seq}`);
  const b = await register(`+49173000${seq}1`, `b${seq}@x.com`, `Bob${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  return { a, b, chatId: chat.json.chat.id };
}

const send = (chatId, token, body) =>
  api(`/api/chats/${chatId}/messages`, { method: 'POST', token, body: { body } });

// ---- Threads ---------------------------------------------------------------

test('threads: replies live in the thread, not the main timeline, and bump the count', async () => {
  const { a, b, chatId } = await fixture('40');
  const root = await send(chatId, a.token, 'Lasst uns das hier besprechen');
  const rootId = root.json.message.id;
  assert.equal(root.json.message.threadCount, 0);

  const r1 = await api(`/api/chats/${chatId}/messages/${rootId}/thread`, {
    method: 'POST', token: b.token, body: { body: 'Gute Idee!' },
  });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  assert.equal(r1.json.message.threadRoot, rootId);

  await api(`/api/chats/${chatId}/messages/${rootId}/thread`, {
    method: 'POST', token: a.token, body: { body: 'Finde ich auch' },
  });

  // The thread endpoint returns both replies + the root with its updated count.
  const thread = await api(`/api/chats/${chatId}/messages/${rootId}/thread`, { token: a.token });
  assert.equal(thread.json.messages.length, 2);
  assert.equal(thread.json.root.threadCount, 2);

  // The main timeline shows the root but NOT the thread replies.
  const hist = await api(`/api/chats/${chatId}/messages`, { token: a.token });
  const ids = hist.json.messages.map((m) => m.id);
  assert.ok(ids.includes(rootId), 'root stays in the timeline');
  assert.ok(!thread.json.messages.some((m) => ids.includes(m.id)), 'replies stay out of the timeline');
});

// ---- Live location ---------------------------------------------------------

test('live location: start, move, stop', async () => {
  const { a, chatId } = await fixture('41');
  const start = await api(`/api/chats/${chatId}/livelocation`, {
    method: 'POST', token: a.token,
    body: { lat: 48.2, lng: 16.37, durationMinutes: 30 },
  });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.message.type, 'livelocation');
  assert.equal(start.json.message.liveLocation.active, true);
  assert.equal(start.json.message.liveLocation.lat, 48.2);

  const upd = await api(`/api/chats/${chatId}/livelocation/update`, {
    method: 'POST', token: a.token, body: { lat: 48.21, lng: 16.38 },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));

  const stop = await api(`/api/chats/${chatId}/livelocation/stop`, { method: 'POST', token: a.token });
  assert.equal(stop.status, 200);
  // After stopping there is no active share → update 404s.
  const again = await api(`/api/chats/${chatId}/livelocation/update`, {
    method: 'POST', token: a.token, body: { lat: 1, lng: 1 },
  });
  assert.equal(again.status, 404);
});

// ---- Scheduled calls -------------------------------------------------------

test('scheduled calls: create, list, reminder fires once, cancel', async () => {
  const { a, b, chatId } = await fixture('42');
  const startAt = Date.now() + 60 * 60 * 1000;
  const created = await api(`/api/chats/${chatId}/scheduled-calls`, {
    method: 'POST', token: a.token,
    body: { title: 'Sync', video: true, startAt, remindMinutes: 10 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const callId = created.json.call.id;
  assert.equal(created.json.call.video, true);

  const list = await api('/api/me/scheduled-calls', { token: b.token });
  assert.equal(list.json.calls.length, 1);
  assert.ok(list.json.calls[0].chatTitle !== undefined);

  // Force the reminder due and sweep.
  db.prepare('UPDATE scheduled_calls SET remind_at = ? WHERE id = ?').run(Date.now() - 1000, callId);
  assert.equal(runMaintenance().firedCalls, 1, 'fires once');
  assert.equal(runMaintenance().firedCalls, 0, 'and never again');

  // Only the creator can cancel.
  const badCancel = await api(`/api/chats/${chatId}/scheduled-calls/${callId}`, { method: 'DELETE', token: b.token });
  assert.equal(badCancel.status, 403);
  const cancel = await api(`/api/chats/${chatId}/scheduled-calls/${callId}`, { method: 'DELETE', token: a.token });
  assert.equal(cancel.status, 200);
});

// ---- Kanban boards ---------------------------------------------------------

test('boards: create, add column + card, move card', async () => {
  const { a, b, chatId } = await fixture('43');
  const created = await api(`/api/chats/${chatId}/boards`, {
    method: 'POST', token: a.token, body: { title: 'Sprint' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msg = created.json.message;
  assert.equal(msg.type, 'board');
  assert.equal(msg.board.columns.length, 3, 'default columns');
  const msgId = msg.id;
  const todo = msg.board.columns[0].id;
  const doing = msg.board.columns[1].id;

  const card = await api(`/api/chats/${chatId}/messages/${msgId}/board/cards`, {
    method: 'POST', token: b.token, body: { columnId: todo, text: 'Login bauen' },
  });
  assert.equal(card.status, 201, JSON.stringify(card.json));
  const cardId = card.json.message.board.columns[0].cards[0].id;
  assert.equal(card.json.message.board.columns[0].cards[0].text, 'Login bauen');

  const moved = await api(`/api/chats/${chatId}/messages/${msgId}/board/cards/${cardId}/move`, {
    method: 'POST', token: a.token, body: { columnId: doing },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(moved.json.message.board.columns[0].cards.length, 0, 'left the todo column');
  assert.equal(moved.json.message.board.columns[1].cards.length, 1, 'arrived in doing');
});

// ---- Mini-games ------------------------------------------------------------

test('games: tic-tac-toe enforces turns and detects a win', async () => {
  const { a, b, chatId } = await fixture('44');
  const created = await api(`/api/chats/${chatId}/games`, {
    method: 'POST', token: a.token, body: { kind: 'tictactoe' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const msgId = created.json.message.id;
  assert.equal(created.json.message.game.kind, 'tictactoe');

  const move = (token, cell) =>
    api(`/api/chats/${chatId}/messages/${msgId}/game/move`, { method: 'POST', token, body: { cell } });

  // A (seat 0) plays 0; B (seat 1) plays 3; A 1; B 4; A 2 → top row wins.
  assert.equal((await move(a.token, 0)).status, 200);
  // B can't play out of turn before taking their move — it's B's turn now.
  assert.equal((await move(a.token, 1)).status, 400, 'not As turn');
  assert.equal((await move(b.token, 3)).status, 200);
  assert.equal((await move(a.token, 1)).status, 200);
  assert.equal((await move(b.token, 4)).status, 200);
  const win = await move(a.token, 2);
  assert.equal(win.status, 200);
  assert.equal(win.json.message.game.winner, a.user.id, 'A completes the top row');
});

// ---- Search integration ----------------------------------------------------

test('typ:board and typ:spiel filters find the new structured types', async () => {
  const { a, chatId } = await fixture('45');
  await api(`/api/chats/${chatId}/boards`, {
    method: 'POST', token: a.token, body: { title: 'Findbares Board' },
  });
  await api(`/api/chats/${chatId}/games`, {
    method: 'POST', token: a.token, body: { kind: 'connect4' },
  });
  const b = await api('/api/messages/search?q=' + encodeURIComponent('typ:board'), { token: a.token });
  assert.ok(b.json.messages.some((m) => m.type === 'board'), 'finds the board');
  const g = await api('/api/messages/search?q=' + encodeURIComponent('typ:spiel'), { token: a.token });
  assert.ok(g.json.messages.some((m) => m.type === 'game'), 'finds the game');
});

// ---- Wave B: stickers, view-once, chat themes ------------------------------

test('stickers: create a pack, add a sticker, send it', async () => {
  const { a, chatId } = await fixture('50');
  // Seed an upload row directly (the multipart upload path is out of scope here).
  db.prepare('INSERT INTO uploads (id, owner_id, mime, name, size, created_at) VALUES (?,?,?,?,?,?)')
    .run('upk50', a.user.id, 'image/webp', 's.webp', 100, Date.now());
  const pack = await api('/api/stickers/packs', { method: 'POST', token: a.token, body: { name: 'Memes' } });
  assert.equal(pack.status, 201, JSON.stringify(pack.json));
  const add = await api(`/api/stickers/packs/${pack.json.pack.id}/stickers`, {
    method: 'POST', token: a.token, body: { uploadId: 'upk50', emoji: '😀' },
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  const stickerId = add.json.sticker.id;
  const sent = await api(`/api/chats/${chatId}/stickers`, {
    method: 'POST', token: a.token, body: { stickerId },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.message.type, 'sticker');
  assert.equal(sent.json.message.attachment.kind, 'sticker');
});

test('view-once: the recipient can open exactly once, then it is withheld', async () => {
  const { a, b, chatId } = await fixture('51');
  const sent = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token,
    body: { type: 'image', attachment: { url: '/api/uploads/x51', kind: 'image' }, viewOnce: true },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  const msgId = sent.json.message.id;
  assert.equal(sent.json.message.viewOnce, true);

  // Before opening, the recipient sees it flagged but with no payload.
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  const seen = hist.json.messages.find((m) => m.id === msgId);
  assert.equal(seen.attachment, null, 'payload withheld until opened');

  const open1 = await api(`/api/chats/${chatId}/messages/${msgId}/view`, { method: 'POST', token: b.token });
  assert.equal(open1.status, 200, JSON.stringify(open1.json));
  assert.ok(open1.json.attachment, 'gets the payload once');
  const open2 = await api(`/api/chats/${chatId}/messages/${msgId}/view`, { method: 'POST', token: b.token });
  assert.equal(open2.status, 410, 'second open is spent');
});

test('chat themes: set + read per-chat appearance', async () => {
  const { a, chatId } = await fixture('52');
  const put = await api(`/api/chats/${chatId}/appearance`, {
    method: 'PUT', token: a.token, body: { wallpaper: 'aurora', accent: '#ff8800' },
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.appearance.accent, '#ff8800');
  const get = await api(`/api/chats/${chatId}/appearance`, { token: a.token });
  assert.equal(get.json.appearance.wallpaper, 'aurora');
});

// ---- Wave C: notes, recurring events, media hub, webhooks ------------------

test('group notes: create, edit, list, delete', async () => {
  const { a, b, chatId } = await fixture('53');
  const created = await api(`/api/chats/${chatId}/notes`, {
    method: 'POST', token: a.token, body: { title: 'Reiseplan', body: 'Tag 1: Anreise' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const noteId = created.json.note.id;
  const upd = await api(`/api/chats/${chatId}/notes/${noteId}`, {
    method: 'PUT', token: b.token, body: { body: 'Tag 1: Anreise\nTag 2: Strand' },
  });
  assert.equal(upd.status, 200);
  assert.ok(upd.json.note.body.includes('Strand'));
  const list = await api(`/api/chats/${chatId}/notes`, { token: a.token });
  assert.equal(list.json.notes.length, 1);
  const del = await api(`/api/chats/${chatId}/notes/${noteId}`, { method: 'DELETE', token: a.token });
  assert.equal(del.status, 200);
  const list2 = await api(`/api/chats/${chatId}/notes`, { token: a.token });
  assert.equal(list2.json.notes.length, 0);
});

test('recurring events: a weekly event spawns its next occurrence via the sweep', async () => {
  const { a, chatId } = await fixture('54');
  const startAt = Date.now() + 60 * 60 * 1000;
  const created = await api(`/api/chats/${chatId}/events`, {
    method: 'POST', token: a.token, body: { title: 'Weekly Sync', startAt, recur: 'weekly' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.message.event.recur, 'weekly');
  // Force the start into the past so the sweep spawns the next instance.
  db.prepare('UPDATE events SET start_at = ? WHERE message_id = ?').run(Date.now() - 1000, created.json.message.id);
  const swept = runMaintenance();
  assert.equal(swept.spawnedEvents, 1, 'spawns once');
  assert.equal(runMaintenance().spawnedEvents, 0, 'original cleared its rule');
  const agenda = await api('/api/me/events', { token: a.token });
  assert.ok(agenda.json.events.some((e) => e.title === 'Weekly Sync'), 'the next occurrence is on the agenda');
});

test('media hub: groups a chat\'s images and links', async () => {
  const { a, chatId } = await fixture('55');
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { type: 'image', attachment: { url: '/api/uploads/i55', kind: 'image' } },
  });
  await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'Schau mal https://example.com' },
  });
  const imgs = await api(`/api/chats/${chatId}/media?kind=image`, { token: a.token });
  assert.ok(imgs.json.messages.some((m) => m.type === 'image'), 'finds the image');
  const links = await api(`/api/chats/${chatId}/media?kind=link`, { token: a.token });
  assert.ok(links.json.messages.some((m) => (m.body || '').includes('example.com')), 'finds the link');
});

test('webhooks: an incoming hook fans a message into the chat', async () => {
  const { a, b, chatId } = await fixture('56');
  const created = await api(`/api/chats/${chatId}/webhooks`, {
    method: 'POST', token: a.token, body: { name: 'CI-Bot', direction: 'in' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = created.json.webhook.token;
  assert.ok(token, 'token returned once');
  const post = await api(`/api/hooks/${token}`, { method: 'POST', body: { text: 'Build grün ✅' } });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.ok(hist.json.messages.some((m) => (m.body || '').includes('Build grün')), 'message arrived');
  // Listing never echoes the token.
  const list = await api(`/api/chats/${chatId}/webhooks`, { token: a.token });
  assert.ok(list.json.webhooks.every((w) => !('token' in w)), 'token not echoed in listings');
});

// ---- Wave D: e2ee, default-ttl, screenshot, login approval -----------------

test('e2ee: publish identities + enable a DM session, peer key is served', async () => {
  const { a, b, chatId } = await fixture('57');
  await api('/api/me/e2ee/identity', { method: 'PUT', token: a.token, body: { publicKey: 'A'.repeat(44) } });
  await api('/api/me/e2ee/identity', { method: 'PUT', token: b.token, body: { publicKey: 'B'.repeat(44) } });
  const on = await api(`/api/chats/${chatId}/e2ee`, { method: 'POST', token: a.token, body: { enabled: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.session.enabled, true);
  const view = await api(`/api/chats/${chatId}/e2ee`, { token: b.token });
  assert.equal(view.json.session.enabled, true);
  assert.equal(view.json.peer.publicKey, 'A'.repeat(44), 'B sees As public key');
});

test('default-ttl: an account default applies to newly started chats', async () => {
  const a = await register('+4917399990', 'ttl-a@x.com', 'TtlA');
  const c = await register('+4917399991', 'ttl-c@x.com', 'TtlC');
  await api('/api/me/default-ttl', { method: 'PUT', token: a.token, body: { seconds: 3600 } });
  const chat = await api('/api/chats/direct', { method: 'POST', token: a.token, body: { phone: c.user.phone } });
  assert.equal(chat.status, 201, JSON.stringify(chat.json));
  assert.equal(chat.json.chat.expireSeconds, 3600, 'new chat inherits the default timer');
});

test('screenshot notice: drops a system message into the chat', async () => {
  const { a, b, chatId } = await fixture('58');
  const r = await api(`/api/chats/${chatId}/screenshot-notice`, { method: 'POST', token: a.token });
  assert.equal(r.status, 201);
  const hist = await api(`/api/chats/${chatId}/messages`, { token: b.token });
  assert.ok(hist.json.messages.some((m) => m.type === 'system' && /Screenshot/.test(m.body)), 'notice posted');
});

test('login approval: a trusted device approves, the new device gets a token', async () => {
  const a = await register('+4917388880', 'appr@x.com', 'Appr');
  const req = await api('/api/auth/login/request-approval', {
    method: 'POST', body: { login: 'appr@x.com', password: 'secret1' },
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const approvalId = req.json.approvalId;
  // Still pending before any decision.
  const poll1 = await api(`/api/auth/login/approval/${approvalId}`);
  assert.equal(poll1.json.status, 'pending');
  // The existing device (a's token) approves.
  const dec = await api(`/api/me/login-approvals/${approvalId}/decision`, {
    method: 'POST', token: a.token, body: { approve: true },
  });
  assert.equal(dec.status, 200);
  const poll2 = await api(`/api/auth/login/approval/${approvalId}`);
  assert.equal(poll2.json.status, 'approved');
  assert.ok(poll2.json.token, 'mints a session token on approval');
});

// ---- Wave E: heuristic catch-up + smart replies, graceful KI gating --------

test('catch-up: summarises recent inbound messages (heuristic, local)', async () => {
  const { a, b, chatId } = await fixture('60');
  await send(chatId, b.token, 'Wir treffen uns morgen zum Projekt Roadmap');
  await send(chatId, b.token, 'Bitte denk an die Roadmap Unterlagen');
  const cu = await api(`/api/chats/${chatId}/catchup`, { token: a.token });
  assert.equal(cu.status, 200, JSON.stringify(cu.json));
  assert.ok(cu.json.summary.count >= 2);
  assert.ok(cu.json.summary.keywords.includes('roadmap'), 'pulls the recurring keyword');
});

test('smart replies: question gets affirmative/negative suggestions', async () => {
  const { a, b, chatId } = await fixture('61');
  await send(chatId, b.token, 'Kommst du morgen mit?');
  const sr = await api(`/api/chats/${chatId}/smart-replies`, { token: a.token });
  assert.equal(sr.status, 200, JSON.stringify(sr.json));
  assert.equal(sr.json.suggestions.length, 3);
});

test('translation + GIF search degrade gracefully when unconfigured', async () => {
  const { a } = await fixture('62');
  const tr = await api('/api/translate/available', { token: a.token });
  assert.equal(tr.json.available, false);
  const gif = await api('/api/gifs/search?q=cat', { token: a.token });
  assert.equal(gif.json.available, false);
  assert.deepEqual(gif.json.results, []);
  // An empty query short-circuits without hitting any provider (no key needed).
  const empty = await api('/api/gifs/search?q=%20%20', { token: a.token });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.available, true);
  assert.deepEqual(empty.json.results, []);
});
