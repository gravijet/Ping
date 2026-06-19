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

const snapshot = (metrics, app = 'android') =>
  api('/api/telemetry/device', { method: 'POST', body: { app, metrics } });

test('device snapshot accepts a bucketed payload (202)', async () => {
  const r = await snapshot({ android: '14', net: 'wifi', battery: '40-59', ram: '6-8' });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
});

test('device snapshot tolerates an empty metrics map', async () => {
  const r = await api('/api/telemetry/device', { method: 'POST', body: { app: 'android' } });
  assert.equal(r.status, 202);
});

test('device snapshot rejects an over-long bucket label (>24 chars)', async () => {
  const r = await snapshot({ net: 'x'.repeat(25) });
  assert.equal(r.status, 400);
});

test('fleet aggregates buckets across snapshots and exposes them to admin', async () => {
  await snapshot({ android: '14', net: 'wifi' });
  await snapshot({ android: '14', net: 'cellular' });
  await snapshot({ android: '13', net: 'wifi' });

  const r = await api('/api/admin/diagnostics?days=7', { admin: ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.fleet, 'response should carry a fleet block');

  const android = r.json.fleet.metrics.android || [];
  const v14 = android.find((b) => b.bucket === '14');
  assert.ok(v14 && v14.count >= 3, 'android 14 should be the leading bucket: ' + JSON.stringify(android));
  // Distribution is sorted biggest-first, so '14' precedes '13'.
  assert.equal(android[0].bucket, '14');

  const net = r.json.fleet.metrics.net || [];
  assert.ok(net.some((b) => b.bucket === 'cellular'));
  assert.ok(r.json.fleet.apps.includes('android'));
});

test('fleet telemetry is admin-gated', async () => {
  const r = await api('/api/admin/diagnostics');
  assert.ok(r.status === 401 || r.status === 403, 'expected 401/403, got ' + r.status);
});
