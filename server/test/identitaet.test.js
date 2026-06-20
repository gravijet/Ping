// 0.32.0 "Identität & Schutz": public @usernames + people directory, two-factor
// auth (TOTP + recovery codes), expanded privacy controls (who may DM / add to
// groups, username discoverability) and the security centre (audit log + "log
// out everywhere" via the session epoch).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createServer } = await import('../src/index.js');
const { generateToken } = await import('../src/totp.js');

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

let seq = 700;
async function user(name) {
  seq += 1;
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { phone: `+4916${seq}00000`, email: `u${seq}@e.com`, displayName: name, password: 'secret1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

// ---- Usernames -------------------------------------------------------------

test('username: claim, uniqueness, reserved + availability check', async () => {
  const a = await user('Alice');
  const b = await user('Bob');

  // Availability before claiming.
  let chk = await api('/api/me/username/check?u=alice', { token: a.token });
  assert.equal(chk.json.available, true);

  // Claim it.
  let r = await api('/api/me/username', { method: 'PUT', token: a.token, body: { username: 'Alice' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.username, 'alice'); // lowercased

  // Now taken for everyone else.
  chk = await api('/api/me/username/check?u=alice', { token: b.token });
  assert.equal(chk.json.available, false);

  // Bob can't claim it.
  r = await api('/api/me/username', { method: 'PUT', token: b.token, body: { username: 'alice' } });
  assert.equal(r.status, 409);

  // Reserved names are refused.
  r = await api('/api/me/username', { method: 'PUT', token: b.token, body: { username: 'admin' } });
  assert.equal(r.status, 409);

  // Invalid characters fail validation (400).
  r = await api('/api/me/username', { method: 'PUT', token: b.token, body: { username: 'bad name!' } });
  assert.equal(r.status, 400);

  // Re-claiming your own is fine.
  r = await api('/api/me/username', { method: 'PUT', token: a.token, body: { username: 'alice' } });
  assert.equal(r.status, 200);
});

test('username: public lookup + people search honour the discoverable switch', async () => {
  const a = await user('Zoe');
  await api('/api/me/username', { method: 'PUT', token: a.token, body: { username: 'searchme' } });
  const seeker = await user('Seeker');

  // Lookup by handle.
  let r = await api('/api/users/by-username/searchme', { token: seeker.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.username, 'searchme');
  r = await api('/api/users/by-username/nope', { token: seeker.token });
  assert.equal(r.status, 404);

  // People search finds them by @username.
  r = await api('/api/people/search?q=searchme', { token: seeker.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.results.some((u) => u.id === a.user.id));

  // Turn discoverability off → no longer found by username.
  await api('/api/me/privacy', { method: 'POST', token: a.token, body: { usernameSearchable: false } });
  r = await api('/api/people/search?q=searchme', { token: seeker.token });
  assert.ok(!r.json.results.some((u) => u.id === a.user.id));

  // ...but still reachable by exact handle lookup.
  r = await api('/api/users/by-username/searchme', { token: seeker.token });
  assert.equal(r.status, 200);
});

// ---- Two-factor auth -------------------------------------------------------

async function enable2fa(token) {
  const setup = await api('/api/me/2fa/setup', { method: 'POST', token });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const secret = setup.json.secret;
  const en = await api('/api/me/2fa/enable', {
    method: 'POST',
    token,
    body: { code: generateToken(secret) },
  });
  assert.equal(en.status, 200, JSON.stringify(en.json));
  assert.equal(en.json.recoveryCodes.length, 10);
  return { secret, recoveryCodes: en.json.recoveryCodes };
}

test('2fa: setup → enable → login challenge → TOTP + recovery code paths', async () => {
  seq += 1;
  const phone = `+4917${seq}00000`;
  const email = `tfa${seq}@e.com`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, email, displayName: 'TwoFA', password: 'secret1' },
  });
  assert.equal(reg.status, 201);
  const token = reg.json.token;

  const { secret, recoveryCodes } = await enable2fa(token);

  // /me now reports 2FA on.
  const me = await api('/api/me', { token });
  assert.equal(me.json.user.twoFactor, true);

  // Password-only login is now a challenge, not a session.
  let login = await api('/api/auth/login', { method: 'POST', body: { login: email, password: 'secret1' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.twoFactorRequired, true);
  assert.ok(login.json.challenge);
  assert.equal(login.json.token, undefined);

  // Wrong code is rejected.
  let step2 = await api('/api/auth/login/2fa', {
    method: 'POST',
    body: { challenge: login.json.challenge, code: '000000' },
  });
  assert.equal(step2.status, 401);

  // Correct TOTP completes the login.
  step2 = await api('/api/auth/login/2fa', {
    method: 'POST',
    body: { challenge: login.json.challenge, code: generateToken(secret) },
  });
  assert.equal(step2.status, 200, JSON.stringify(step2.json));
  assert.ok(step2.json.token);
  assert.equal(step2.json.twoFactor, true);

  // A recovery code also completes a login — once.
  login = await api('/api/auth/login', { method: 'POST', body: { login: email, password: 'secret1' } });
  const rc = recoveryCodes[0];
  step2 = await api('/api/auth/login/2fa', {
    method: 'POST',
    body: { challenge: login.json.challenge, recoveryCode: rc },
  });
  assert.equal(step2.status, 200, JSON.stringify(step2.json));

  // The same recovery code can't be replayed.
  login = await api('/api/auth/login', { method: 'POST', body: { login: email, password: 'secret1' } });
  step2 = await api('/api/auth/login/2fa', {
    method: 'POST',
    body: { challenge: login.json.challenge, recoveryCode: rc },
  });
  assert.equal(step2.status, 401);

  // Disable requires the password (+ a code while enabled).
  let dis = await api('/api/me/2fa/disable', { method: 'POST', token, body: { password: 'wrong' } });
  assert.equal(dis.status, 403);
  dis = await api('/api/me/2fa/disable', {
    method: 'POST',
    token,
    body: { password: 'secret1', code: generateToken(secret) },
  });
  assert.equal(dis.status, 200);
  assert.equal(dis.json.enabled, false);

  // Login is a plain session again.
  login = await api('/api/auth/login', { method: 'POST', body: { login: email, password: 'secret1' } });
  assert.ok(login.json.token);
  assert.equal(login.json.twoFactorRequired, undefined);
});

// ---- Privacy enforcement ---------------------------------------------------

test('privacy: messages=contacts blocks cold DMs, allows known peers', async () => {
  const a = await user('Private');
  const stranger = await user('Stranger');
  // Lock down who may DM.
  let r = await api('/api/me/privacy', { method: 'POST', token: a.token, body: { messages: 'contacts' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.privacyMessages, 'contacts');

  // A stranger can't open a fresh DM.
  r = await api('/api/chats/direct', { method: 'POST', token: stranger.token, body: { userId: a.user.id } });
  assert.equal(r.status, 403, JSON.stringify(r.json));

  // Once A reaches out (creating a shared chat), the peer becomes connected.
  r = await api('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: stranger.user.id } });
  assert.equal(r.status, 201);
  // Now the (formerly) stranger can open the DM too.
  r = await api('/api/chats/direct', { method: 'POST', token: stranger.token, body: { userId: a.user.id } });
  assert.equal(r.status, 201);
});

test('privacy: groups=contacts skips non-contact adds', async () => {
  const shy = await user('Shy');
  const adder = await user('Adder');
  await api('/api/me/privacy', { method: 'POST', token: shy.token, body: { groups: 'contacts' } });

  // Adder makes a group and tries to add Shy (no relationship) → skipped.
  let g = await api('/api/chats/group', { method: 'POST', token: adder.token, body: { name: 'Crew', memberIds: [] } });
  assert.equal(g.status, 201);
  const chatId = g.json.chat.id;
  let r = await api(`/api/chats/${chatId}/members`, { method: 'POST', token: adder.token, body: { memberIds: [shy.user.id] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.added.length, 0);
  assert.deepEqual(r.json.skipped, ['Shy']);
});

// ---- Sessions + security log -----------------------------------------------

test('logout-all bumps the session epoch and invalidates old tokens', async () => {
  const a = await user('Sessions');
  const oldToken = a.token;
  // Old token works.
  let r = await api('/api/me', { token: oldToken });
  assert.equal(r.status, 200);

  // Log out everywhere → new token returned, old one dies.
  r = await api('/api/me/logout-all', { method: 'POST', token: oldToken });
  assert.equal(r.status, 200);
  const newToken = r.json.token;
  assert.ok(newToken && newToken !== oldToken);

  r = await api('/api/me', { token: oldToken });
  assert.equal(r.status, 401);
  r = await api('/api/me', { token: newToken });
  assert.equal(r.status, 200);
});

test('security log records account-security events', async () => {
  const a = await user('Logger');
  await api('/api/me/username', { method: 'PUT', token: a.token, body: { username: 'loggeruser' } });
  await api('/api/me/privacy', { method: 'POST', token: a.token, body: { showLastSeen: false } });
  const r = await api('/api/me/security-log', { token: a.token });
  assert.equal(r.status, 200);
  const types = r.json.events.map((e) => e.type);
  assert.ok(types.includes('username_changed'));
  assert.ok(types.includes('privacy_changed'));
  // Every event carries a human label.
  assert.ok(r.json.events.every((e) => typeof e.label === 'string' && e.label.length > 0));
});
