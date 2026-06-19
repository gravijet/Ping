/* validation-extra.test.js — server-side schema guards. Confirms the changelog/
   newsroom post schema (used by the in-app admin console that publishes "Was ist
   neu") accepts well-formed input and rejects the obvious bad cases, so a
   malformed publish can never reach the database. Pure (zod only, no DB). */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// validation.js → config.js reads these at import; mirror the api test harness.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret';
process.env.NODE_ENV = 'test';

const { postCreateSchema } = await import('../src/validation.js');

test('postCreateSchema accepts a valid changelog post', () => {
  const r = postCreateSchema.safeParse({
    kind: 'changelog', title: 'Version 0.22.0', version: '0.22.0',
    tag: 'feature', summary: 'Offline-first.', body: 'Details …', published: true,
  });
  assert.equal(r.success, true);
});

test('postCreateSchema rejects an unknown kind', () => {
  assert.equal(postCreateSchema.safeParse({ kind: 'memo', title: 'x' }).success, false);
});

test('postCreateSchema rejects an empty title', () => {
  assert.equal(postCreateSchema.safeParse({ kind: 'news', title: '' }).success, false);
});

test('postCreateSchema rejects an unknown tag but allows the empty tag', () => {
  assert.equal(postCreateSchema.safeParse({ kind: 'news', title: 'x', tag: 'bogus' }).success, false);
  assert.equal(postCreateSchema.safeParse({ kind: 'news', title: 'x', tag: '' }).success, true);
});

test('postCreateSchema rejects an over-long body', () => {
  const r = postCreateSchema.safeParse({ kind: 'news', title: 'x', body: 'a'.repeat(20001) });
  assert.equal(r.success, false);
});
