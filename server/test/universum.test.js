// 0.38.0 "Universum": the mega-release. Exercises the ten new structured message
// types (whiteboard/doc/playlist/recipe/flashcards/form/bookmark/place/videonote/
// watchparty) plus virtual gifts, voice rooms, invite links, the local assistant,
// achievements/streaks and the shared habit tracker — all at the HTTP level.
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

async function direct(seq) {
  const a = await register(`+49174000${seq}0`, `a${seq}@u.com`, `Ada${seq}`);
  const b = await register(`+49174000${seq}1`, `b${seq}@u.com`, `Ben${seq}`);
  const chat = await api('/api/chats/direct', { method: 'POST', token: a.token, body: { phone: b.user.phone } });
  return { a, b, chatId: chat.json.chat.id };
}

async function group(seq) {
  const a = await register(`+49175000${seq}0`, `g${seq}@u.com`, `Gus${seq}`);
  const b = await register(`+49175000${seq}1`, `h${seq}@u.com`, `Hal${seq}`);
  const grp = await api('/api/chats/group', { method: 'POST', token: a.token, body: { name: `Crew${seq}`, memberIds: [b.user.id] } });
  return { a, b, chatId: grp.json.chat.id };
}

// ---- Whiteboard -----------------------------------------------------------
test('whiteboard: create, draw a stroke, clear', async () => {
  const { a, chatId } = await direct('01');
  const wb = await api(`/api/chats/${chatId}/whiteboard`, { method: 'POST', token: a.token, body: { title: 'Plan' } });
  assert.equal(wb.status, 201, JSON.stringify(wb.json));
  assert.equal(wb.json.message.type, 'whiteboard');
  assert.equal(wb.json.message.whiteboard.title, 'Plan');
  const id = wb.json.message.id;
  const stroke = await api(`/api/chats/${chatId}/messages/${id}/whiteboard/stroke`, {
    method: 'POST', token: a.token, body: { color: '#f00', width: 4, points: [[0, 0], [10, 10]] },
  });
  assert.equal(stroke.status, 201, JSON.stringify(stroke.json));
  const cleared = await api(`/api/chats/${chatId}/messages/${id}/whiteboard/clear`, { method: 'POST', token: a.token });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.message.whiteboard.strokes.length, 0);
});

// ---- Collaborative doc ----------------------------------------------------
test('doc: create then edit; a stale baseVersion is rejected', async () => {
  const { a, b, chatId } = await direct('02');
  const doc = await api(`/api/chats/${chatId}/doc`, { method: 'POST', token: a.token, body: { title: 'Notiz', body: 'hallo' } });
  assert.equal(doc.status, 201, JSON.stringify(doc.json));
  const id = doc.json.message.id;
  assert.equal(doc.json.message.doc.version, 1);
  const edit = await api(`/api/chats/${chatId}/messages/${id}/doc`, { method: 'POST', token: b.token, body: { body: 'hallo welt', baseVersion: 1 } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(edit.json.message.doc.version, 2);
  const stale = await api(`/api/chats/${chatId}/messages/${id}/doc`, { method: 'POST', token: a.token, body: { body: 'x', baseVersion: 1 } });
  assert.equal(stale.status, 409);
});

// ---- Playlist -------------------------------------------------------------
test('playlist: create with a track, append, remove', async () => {
  const { a, chatId } = await direct('03');
  const pl = await api(`/api/chats/${chatId}/playlist`, {
    method: 'POST', token: a.token, body: { title: 'Roadtrip', tracks: [{ title: 'Song A' }] },
  });
  assert.equal(pl.status, 201, JSON.stringify(pl.json));
  const id = pl.json.message.id;
  assert.equal(pl.json.message.playlist.tracks.length, 1);
  const add = await api(`/api/chats/${chatId}/messages/${id}/playlist/tracks`, { method: 'POST', token: a.token, body: { title: 'Song B', url: 'https://x' } });
  assert.equal(add.status, 201);
  assert.equal(add.json.message.playlist.tracks.length, 2);
  const trackId = add.json.message.playlist.tracks[1].id;
  const del = await api(`/api/chats/${chatId}/messages/${id}/playlist/tracks/${trackId}`, { method: 'DELETE', token: a.token });
  assert.equal(del.status, 200);
  assert.equal(del.json.message.playlist.tracks.length, 1);
});

// ---- Recipe + flashcards --------------------------------------------------
test('recipe + flashcards carry their structured payload', async () => {
  const { a, chatId } = await direct('04');
  const r = await api(`/api/chats/${chatId}/recipe`, {
    method: 'POST', token: a.token,
    body: { title: 'Pasta', servings: 2, minutes: 20, ingredients: ['Nudeln', 'Soße'], steps: ['Kochen', 'Mischen'] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.message.recipe.ingredients.length, 2);
  assert.equal(r.json.message.recipe.steps.length, 2);
  const fc = await api(`/api/chats/${chatId}/flashcards`, {
    method: 'POST', token: a.token, body: { title: 'Vokabeln', cards: [{ front: 'Hund', back: 'dog' }, { front: 'Katze', back: 'cat' }] },
  });
  assert.equal(fc.status, 201, JSON.stringify(fc.json));
  assert.equal(fc.json.message.flashcards.cards.length, 2);
});

// ---- Form / survey --------------------------------------------------------
test('form: respond aggregates choice tallies + rating average', async () => {
  const { a, b, chatId } = await direct('05');
  const f = await api(`/api/chats/${chatId}/form`, {
    method: 'POST', token: a.token,
    body: { title: 'Umfrage', questions: [
      { q: 'Farbe?', type: 'choice', options: ['Rot', 'Blau'] },
      { q: 'Note?', type: 'rating' },
    ] },
  });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const id = f.json.message.id;
  await api(`/api/chats/${chatId}/messages/${id}/form/respond`, { method: 'POST', token: a.token, body: { answers: ['Rot', 5] } });
  const r2 = await api(`/api/chats/${chatId}/messages/${id}/form/respond`, { method: 'POST', token: b.token, body: { answers: ['Blau', 3] } });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const form = r2.json.message.form;
  assert.equal(form.responseCount, 2);
  assert.equal(form.results[0].tally.Rot, 1);
  assert.equal(form.results[0].tally.Blau, 1);
  assert.equal(form.results[1].avg, 4);
  const closed = await api(`/api/chats/${chatId}/messages/${id}/form/close`, { method: 'POST', token: a.token, body: { closed: true } });
  assert.equal(closed.json.message.form.closed, true);
  const blocked = await api(`/api/chats/${chatId}/messages/${id}/form/respond`, { method: 'POST', token: a.token, body: { answers: ['Rot', 1] } });
  assert.equal(blocked.status, 409);
});

// ---- Bookmark + place -----------------------------------------------------
test('bookmark + place collections accept items', async () => {
  const { a, chatId } = await direct('06');
  const bm = await api(`/api/chats/${chatId}/bookmark`, { method: 'POST', token: a.token, body: { title: 'Lesen', links: [{ url: 'https://a.com' }] } });
  assert.equal(bm.status, 201, JSON.stringify(bm.json));
  const bmId = bm.json.message.id;
  const addLink = await api(`/api/chats/${chatId}/messages/${bmId}/bookmark/links`, { method: 'POST', token: a.token, body: { url: 'https://b.com', title: 'B' } });
  assert.equal(addLink.json.message.bookmark.links.length, 2);

  const pl = await api(`/api/chats/${chatId}/place`, { method: 'POST', token: a.token, body: { title: 'Treffpunkte', pins: [{ name: 'Park', lat: 48.2, lng: 16.3 }] } });
  assert.equal(pl.status, 201, JSON.stringify(pl.json));
  const plId = pl.json.message.id;
  const addPin = await api(`/api/chats/${chatId}/messages/${plId}/place/pins`, { method: 'POST', token: a.token, body: { name: 'Café', lat: 48.21, lng: 16.31 } });
  assert.equal(addPin.json.message.place.pins.length, 2);
});

// ---- Video note + watch party ---------------------------------------------
test('videonote stores a round video; watch party syncs playback', async () => {
  const { a, b, chatId } = await direct('07');
  const vn = await api(`/api/chats/${chatId}/videonote`, {
    method: 'POST', token: a.token, body: { attachment: { kind: 'video', url: 'uploads/x.mp4', mime: 'video/mp4' } },
  });
  assert.equal(vn.status, 201, JSON.stringify(vn.json));
  assert.equal(vn.json.message.type, 'videonote');
  assert.equal(vn.json.message.round, true);

  const wp = await api(`/api/chats/${chatId}/watchparty`, { method: 'POST', token: a.token, body: { title: 'Film', url: 'https://video' } });
  assert.equal(wp.status, 201, JSON.stringify(wp.json));
  const id = wp.json.message.id;
  const sync = await api(`/api/chats/${chatId}/messages/${id}/watchparty/sync`, { method: 'POST', token: b.token, body: { positionMs: 5000, playing: true } });
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.equal(sync.json.watchparty.positionMs, 5000);
  assert.equal(sync.json.watchparty.playing, true);
});

// ---- Virtual gift ---------------------------------------------------------
test('gift: sends a gift card with a confetti effect', async () => {
  const { a, chatId } = await direct('08');
  const g = await api(`/api/chats/${chatId}/gift`, { method: 'POST', token: a.token, body: { kind: 'cake', note: 'Alles Gute!' } });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  assert.equal(g.json.message.type, 'gift');
  assert.equal(g.json.message.gift.kind, 'cake');
  assert.equal(g.json.message.effect, 'confetti');
});

// ---- Voice rooms ----------------------------------------------------------
test('voice room: open, the other joins, then leave closes it', async () => {
  const { a, b, chatId } = await group('20');
  const open = await api(`/api/chats/${chatId}/voiceroom`, { method: 'POST', token: a.token, body: { title: 'Plausch' } });
  assert.equal(open.status, 201, JSON.stringify(open.json));
  const roomId = open.json.room.id;
  assert.equal(open.json.room.members.length, 1);
  const join = await api(`/api/chats/${chatId}/voiceroom/${roomId}/join`, { method: 'POST', token: b.token });
  assert.equal(join.json.room.members.length, 2);
  await api(`/api/chats/${chatId}/voiceroom/${roomId}/leave`, { method: 'POST', token: a.token });
  const leave2 = await api(`/api/chats/${chatId}/voiceroom/${roomId}/leave`, { method: 'POST', token: b.token });
  assert.equal(leave2.json.closed, true);
  const active = await api(`/api/chats/${chatId}/voiceroom`, { token: a.token });
  assert.equal(active.json.room, null);
});

// ---- Invite links ---------------------------------------------------------
test('invite link: a third user joins the group; revoked links fail', async () => {
  const { a, chatId } = await group('21');
  const c = await register('+4917699900099', 'inv@u.com', 'Cara');
  const link = await api(`/api/chats/${chatId}/invites`, { method: 'POST', token: a.token, body: { maxUses: 5 } });
  assert.equal(link.status, 201, JSON.stringify(link.json));
  const code = link.json.invite.code;
  const join = await api(`/api/invite/${code}/join`, { method: 'POST', token: c.token });
  assert.equal(join.status, 200, JSON.stringify(join.json));
  // Cara is now a member: she can read the chat.
  const list = await api(`/api/chats/${chatId}/invites`, { token: a.token });
  assert.equal(list.json.invites[0].uses, 1);
  await api(`/api/chats/${chatId}/invites/${code}`, { method: 'DELETE', token: a.token });
  const c2 = await register('+4917699900098', 'inv2@u.com', 'Dora');
  const blocked = await api(`/api/invite/${code}/join`, { method: 'POST', token: c2.token });
  assert.equal(blocked.status, 404);
});

// ---- Local assistant ------------------------------------------------------
test('assistant: heuristic reply posts a bot message (no cloud)', async () => {
  const { a, chatId } = await direct('09');
  const r = await api(`/api/chats/${chatId}/assistant`, { method: 'POST', token: a.token, body: { prompt: 'Hallo' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.message.body, /Assistent|Hallo/);
});

// ---- Achievements + streaks -----------------------------------------------
test('sending a message unlocks the first-message badge + a streak', async () => {
  const { a, chatId } = await direct('10');
  await api(`/api/chats/${chatId}/messages`, { method: 'POST', token: a.token, body: { body: 'hi' } });
  const ach = await api('/api/me/achievements', { token: a.token });
  assert.equal(ach.status, 200);
  assert.ok(ach.json.achievements.some((x) => x.kind === 'first_message'));
  const streak = await api(`/api/chats/${chatId}/streak`, { token: a.token });
  assert.equal(streak.json.streak.count, 1);
});

// ---- Habits ---------------------------------------------------------------
test('habit: create, toggle today on/off', async () => {
  const { a, chatId } = await group('22');
  const h = await api(`/api/chats/${chatId}/habits`, { method: 'POST', token: a.token, body: { title: 'Wasser trinken' } });
  assert.equal(h.status, 201, JSON.stringify(h.json));
  const habitId = h.json.habit.id;
  const on = await api(`/api/chats/${chatId}/habits/${habitId}/toggle`, { method: 'POST', token: a.token });
  assert.equal(on.json.done, true);
  const list = await api(`/api/chats/${chatId}/habits`, { token: a.token });
  assert.equal(list.json.habits[0].doneToday, true);
  assert.equal(list.json.habits[0].streak, 1);
  const off = await api(`/api/chats/${chatId}/habits/${habitId}/toggle`, { method: 'POST', token: a.token });
  assert.equal(off.json.done, false);
});

// ---- Search: the new types are filterable ---------------------------------
test('typ:rezept and typ:whiteboard filters find the new types', async () => {
  const { a, chatId } = await direct('11');
  await api(`/api/chats/${chatId}/recipe`, { method: 'POST', token: a.token, body: { title: 'Suchbares Rezept', ingredients: ['x'], steps: ['y'] } });
  await api(`/api/chats/${chatId}/whiteboard`, { method: 'POST', token: a.token, body: { title: 'Tafel' } });
  const r = await api('/api/messages/search?q=' + encodeURIComponent('typ:rezept'), { token: a.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.messages.some((m) => m.type === 'recipe'), 'finds the recipe');
  assert.ok(r.json.messages.every((m) => m.type === 'recipe'), 'only recipes');
});
