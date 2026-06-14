import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Point the download module at a throwaway dir BEFORE it (via config) is imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ping-apk-'));
process.env.APK_DIR = dir;

const express = (await import('express')).default;
const { mountDownloads } = await import('../src/download.js');

function writeApk(name, contents) {
  const buf = Buffer.from(contents);
  fs.writeFileSync(path.join(dir, name), buf);
  return {
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

// A universal APK + one per-ABI split, plus the manifest publish-apk.sh writes.
// The split is written last on purpose, so "newest by mtime" is the split — this
// verifies the universal is still chosen correctly via version.json's `file`.
const uni = writeApk('ping-2.7.0.apk', 'UNIVERSAL-APK-BYTES');
const arm = writeApk('ping-2.7.0-arm64-v8a.apk', 'ARM64-APK-BYTES-XYZ');
fs.writeFileSync(
  path.join(dir, 'version.json'),
  JSON.stringify({
    version: '2.7.0',
    build: '2.7.0+10',
    versionCode: 10,
    file: 'ping-2.7.0.apk',
    size: uni.size,
    sha256: uni.sha256,
    variants: {
      'arm64-v8a': {
        file: 'ping-2.7.0-arm64-v8a.apk',
        size: arm.size,
        sha256: arm.sha256,
      },
    },
  })
);

const app = express();
mountDownloads(app, dir);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('download info lists the universal build and per-ABI variants', async () => {
  const res = await fetch(base + '/download/info');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.version, '2.7.0');
  assert.equal(json.versionCode, 10);
  assert.equal(json.sha256, uni.sha256); // universal, not the (newer mtime) split
  assert.equal(json.url, '/download');
  assert.ok(json.variants['arm64-v8a']);
  assert.equal(json.variants['arm64-v8a'].url, '/download/abi/arm64-v8a');
  assert.equal(json.variants['arm64-v8a'].sha256, arm.sha256);
});

test('the default download serves the universal apk', async () => {
  const res = await fetch(base + '/download');
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('content-type'),
    'application/vnd.android.package-archive'
  );
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(
    crypto.createHash('sha256').update(body).digest('hex'),
    uni.sha256
  );
});

test('a per-ABI download serves that split; unknown ABI is 404', async () => {
  const ok = await fetch(base + '/download/abi/arm64-v8a');
  assert.equal(ok.status, 200);
  const body = Buffer.from(await ok.arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), arm.sha256);

  const miss = await fetch(base + '/download/abi/x86_64');
  assert.equal(miss.status, 404);
});
