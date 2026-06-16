import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// A strict auth limit so we can prove the link-poll endpoints are exempt from
// it (the desktop polls them every couple of seconds while waiting for a scan).
process.env.DB_FILE = `:memory:`;
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '3';
process.env.API_RATE_MAX = '1000000';

const { createServer } = await import('../src/index.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

test('link polling is not throttled by the strict auth limiter', async () => {
  const startStatus = await post('/api/auth/link/start');
  assert.equal(startStatus, 200);
  const start = await (
    await fetch(base + '/api/auth/link/start', { method: 'POST' })
  ).json();

  // Poll well past the auth limit (3 / window): every one must succeed.
  for (let i = 0; i < 12; i++) {
    const res = await fetch(
      `${base}/api/auth/link/poll?linkId=${start.linkId}&secret=${start.pollSecret}`
    );
    assert.equal(res.status, 200, `poll #${i} should not be rate-limited`);
  }
});

test('ordinary auth endpoints are still throttled', async () => {
  // The strict limiter is shared per-IP across /api/auth/* (minus /auth/link),
  // so a handful of login attempts trips it — proving the limiter is active.
  let saw429 = false;
  for (let i = 0; i < 10; i++) {
    const status = await post('/api/auth/login', {
      login: 'nobody@example.com',
      password: 'whatever',
    });
    if (status === 429) {
      saw429 = true;
      break;
    }
  }
  assert.ok(saw429, 'login should hit the strict auth rate limit');
});
