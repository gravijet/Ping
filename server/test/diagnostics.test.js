import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');

const ADMIN = 'test-admin-token';
let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', admin, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-token': admin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('telemetry accepts an anonymous event batch (202)', async () => {
  const r = await api('/api/telemetry', { method: 'POST', body: {
    app: 'web', aid: 'anon-1',
    events: [{ name: 'app_open' }, { name: 'open_chat' }, { name: 'app_open' }],
  } });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
});

test('telemetry rejects an oversized batch (>50 events)', async () => {
  const events = Array.from({ length: 51 }, (_, i) => ({ name: 'e' + i }));
  const r = await api('/api/telemetry', { method: 'POST', body: { events } });
  assert.equal(r.status, 400);
});

test('telemetry rejects an event with no name', async () => {
  const r = await api('/api/telemetry', { method: 'POST', body: { events: [{ t: 1 }] } });
  assert.equal(r.status, 400);
});

test('client-error stores an anonymous crash report (202)', async () => {
  const r = await api('/api/client-error', { method: 'POST', body: {
    app: 'web', context: 'window', message: 'Boom', stack: 'at x (y:1:1)', url: '/',
  } });
  assert.equal(r.status, 202);
});

test('admin diagnostics summarises events + errors', async () => {
  const r = await api('/api/admin/diagnostics?days=7', { admin: ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.topEvents));
  assert.ok(r.json.topEvents.some((e) => e.name === 'app_open' && e.count >= 2),
    'app_open should be aggregated: ' + JSON.stringify(r.json.topEvents));
  assert.ok(r.json.totalErrors >= 1);
  assert.ok(r.json.recentErrors.some((e) => e.message === 'Boom'));
});

test('admin diagnostics requires admin auth', async () => {
  const r = await api('/api/admin/diagnostics');
  assert.ok(r.status === 401 || r.status === 403, 'expected 401/403, got ' + r.status);
});

// ---- Fehlerberichte: de-dup, triage status, resolve route ----------------

const findErr = (json, msg) => json.recentErrors.find((e) => e.message === msg);
const postCrash = (over = {}) =>
  api('/api/client-error', {
    method: 'POST',
    body: { app: 'web', appVersion: '9.9.9', context: 'window', message: 'DedupBoom',
      stack: 'at render (chat.js:10:1)', ...over },
  });

test('duplicate crashes collapse into one row (count++, version stored)', async () => {
  await postCrash();                                   // first occurrence
  await postCrash({ stack: 'at render (chat.js:42:9)' }); // same crash, shifted line → same fp

  const r = await api('/api/admin/diagnostics', { admin: ADMIN });
  const e = findErr(r.json, 'DedupBoom');
  assert.ok(e, 'DedupBoom report should exist');
  assert.equal(e.count, 2, 'same crash should de-duplicate to count 2');
  assert.equal(e.status, 'open');
  assert.equal(e.appVersion, '9.9.9');
  assert.ok(typeof r.json.openErrors === 'number' && r.json.openErrors >= 1);
});

test('a distinct crash is a separate report', async () => {
  await postCrash({ message: 'OtherBoom', stack: 'at zap (app.js:5:5)' });
  const r = await api('/api/admin/diagnostics', { admin: ADMIN });
  assert.ok(findErr(r.json, 'OtherBoom'));
  assert.ok(findErr(r.json, 'DedupBoom'));
});

test('admin resolve route closes a report and it leaves the open inbox', async () => {
  let r = await api('/api/admin/diagnostics', { admin: ADMIN });
  const id = findErr(r.json, 'DedupBoom').id;
  const openBefore = r.json.openErrors;

  const res = await api('/api/admin/errors/resolve', { method: 'POST', admin: ADMIN, body: { id } });
  assert.equal(res.status, 200);
  assert.ok(res.json.resolved >= 1);

  r = await api('/api/admin/diagnostics', { admin: ADMIN });
  assert.equal(findErr(r.json, 'DedupBoom').status, 'resolved');
  assert.ok(r.json.openErrors <= openBefore - 1, 'open count should drop after resolve');
});

test('a recurrence re-opens a resolved report', async () => {
  await postCrash(); // same fp as the now-resolved DedupBoom
  const r = await api('/api/admin/diagnostics', { admin: ADMIN });
  assert.equal(findErr(r.json, 'DedupBoom').status, 'open', 'recurrence should reopen');
});

test('resolve route requires admin auth', async () => {
  const r = await api('/api/admin/errors/resolve', { method: 'POST', body: { id: 1 } });
  assert.ok(r.status === 401 || r.status === 403, 'expected 401/403, got ' + r.status);
});
