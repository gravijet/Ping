// 0.28.0 "Kontext": rich link previews (SSRF-guarded fetch + cache) and message
// edit history. Pure-unit coverage of the link-preview internals plus end-to-end
// route coverage over a live server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
process.env.ADMIN_TOKEN = 'test-admin-token';

const { isPrivateIp, assertSafeUrl, parseMetadata } = await import('../src/linkPreview.js');
const { createServer } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { clearLinkPreviewCache } = await import('../src/linkPreviewRepo.js');

// ---- Pure: SSRF guard ------------------------------------------------------

test('isPrivateIp flags loopback / RFC1918 / link-local / metadata / ULA', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.5', '172.16.4.4', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1',
    'fd00::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3',
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test('isPrivateIp allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test('assertSafeUrl rejects non-http(s), private hosts and bad input', async () => {
  for (const url of [
    'ftp://example.com', 'javascript:alert(1)', 'file:///etc/passwd',
    'http://127.0.0.1/', 'http://localhost/', 'https://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://foo.local/', 'http://service.internal/', 'not-a-url',
  ]) {
    await assert.rejects(() => assertSafeUrl(url), `${url} should be rejected`);
  }
});

test('assertSafeUrl accepts a public IP literal (no DNS needed)', async () => {
  const u = await assertSafeUrl('https://8.8.8.8/path');
  assert.equal(u.hostname, '8.8.8.8');
});

// ---- Pure: HTML metadata parser -------------------------------------------

test('parseMetadata prefers OpenGraph and resolves relative images', () => {
  const html = `<html><head>
    <title>Fallback Title</title>
    <meta property="og:title" content="OG Title">
    <meta property="og:description" content="A nice description.">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Example">
  </head><body><meta property="og:title" content="ignored in body"></body></html>`;
  const m = parseMetadata(html, 'https://example.com/a/b');
  assert.equal(m.title, 'OG Title');
  assert.equal(m.description, 'A nice description.');
  assert.equal(m.image, 'https://example.com/img/cover.png');
  assert.equal(m.siteName, 'Example');
});

test('parseMetadata falls back to twitter:* then <title>, decodes entities', () => {
  const tw = parseMetadata(
    '<head><meta name="twitter:title" content="Tw &amp; Co"><meta name="twitter:image" content="https://x/y.jpg"></head>',
    'https://x.test/'
  );
  assert.equal(tw.title, 'Tw & Co');
  assert.equal(tw.image, 'https://x/y.jpg');

  const t = parseMetadata("<head><title>Just &#39;Title&#39;</title></head>", 'https://host.test/');
  assert.equal(t.title, "Just 'Title'");
  assert.equal(t.siteName, 'host.test'); // derived from host when no og:site_name
});

test('parseMetadata returns null when there is no title at all', () => {
  assert.equal(parseMetadata('<head><meta name="description" content="x"></head>', 'https://x/'), null);
});

test('parseMetadata drops non-http image schemes', () => {
  const m = parseMetadata(
    '<head><title>T</title><meta property="og:image" content="data:image/png;base64,AAAA"></head>',
    'https://x/'
  );
  assert.equal(m.image, '');
});

// ---- Integration: live server ---------------------------------------------

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
  const a = await register(`+49171000${seq}0`, `ka${seq}@e.com`, `KA${seq}`);
  const b = await register(`+49171000${seq}1`, `kb${seq}@e.com`, `KB${seq}`);
  const chat = await api('/api/chats/direct', {
    method: 'POST', token: a.token, body: { phone: b.user.phone },
  });
  const chatId = chat.json.chat.id;
  const msg = await api(`/api/chats/${chatId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'v1' },
  });
  return { a, b, chatId, msgId: msg.json.message.id };
}

// ---- Edit history ----------------------------------------------------------

test('editing a message snapshots prior versions and bumps editCount', async () => {
  const { a, chatId, msgId } = await fixture('30');

  let r = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: a.token, body: { body: 'v2' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.message.body, 'v2');
  assert.equal(r.json.message.editCount, 1);

  r = await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: a.token, body: { body: 'v3' },
  });
  assert.equal(r.json.message.editCount, 2);

  const hist = await api(`/api/chats/${chatId}/messages/${msgId}/edits`, { token: a.token });
  assert.equal(hist.status, 200, JSON.stringify(hist.json));
  assert.deepEqual(hist.json.versions.map((v) => v.body), ['v1', 'v2', 'v3']);
  assert.equal(hist.json.versions.at(-1).current, true);
});

test('a no-op edit does not create a history row', async () => {
  const { a, chatId, msgId } = await fixture('31');
  await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: a.token, body: { body: 'v1' }, // unchanged
  });
  const hist = await api(`/api/chats/${chatId}/messages/${msgId}/edits`, { token: a.token });
  assert.equal(hist.json.versions.length, 1); // just the current body
});

test('edit history is visible to the other chat member but not to outsiders', async () => {
  const { a, b, chatId, msgId } = await fixture('32');
  await api(`/api/chats/${chatId}/messages/${msgId}`, {
    method: 'PATCH', token: a.token, body: { body: 'v2' },
  });
  const asPeer = await api(`/api/chats/${chatId}/messages/${msgId}/edits`, { token: b.token });
  assert.equal(asPeer.status, 200);
  assert.equal(asPeer.json.versions.length, 2);

  const outsider = await register('+4917100099', 'out@e.com', 'Out');
  const denied = await api(`/api/chats/${chatId}/messages/${msgId}/edits`, { token: outsider.token });
  assert.equal(denied.status, 403);
});

// ---- Link-preview route ----------------------------------------------------

test('link-preview requires auth and validates the URL', async () => {
  const noAuth = await api('/api/link-preview?url=https://example.com');
  assert.equal(noAuth.status, 401);

  const me = await register('+4917100020', 'lp@e.com', 'LP');
  for (const url of ['not-a-url', 'ftp://example.com', 'javascript:alert(1)']) {
    const bad = await api(`/api/link-preview?url=${encodeURIComponent(url)}`, { token: me.token });
    assert.equal(bad.status, 400, `${url} should 400`);
  }
});

test('link-preview returns null (no network) for a private/loopback host', async () => {
  const me = await register('+4917100021', 'lp2@e.com', 'LP2');
  const r = await api('/api/link-preview?url=' + encodeURIComponent('http://127.0.0.1:1/x'), {
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.preview, null);
});

test('link-preview serves a cached entry without refetching', async () => {
  clearLinkPreviewCache();
  const url = 'https://cached.example/post';
  db.prepare(
    `INSERT INTO link_previews (url, ok, title, description, image, site_name, final_url, fetched_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
  ).run(url, 'Cached Title', 'Desc', 'https://cached.example/i.png', 'Example', url, Date.now());

  const me = await register('+4917100022', 'lp3@e.com', 'LP3');
  const r = await api('/api/link-preview?url=' + encodeURIComponent(url), { token: me.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.preview.title, 'Cached Title');
  assert.equal(r.json.preview.siteName, 'Example');
  assert.equal(r.json.preview.url, url);
});
