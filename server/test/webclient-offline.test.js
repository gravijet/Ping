/* webclient-offline.test.js — unit tests for the PURE logic added in 0.22.0:
   the offline cache transforms (cache.js), the read/delivered sync-queue dedup
   (syncqueue.js), deep-link id validation (validate.js) and the performance
   metric shaping (telemetry.js). None of these touch the DOM or IndexedDB, so we
   only shim a minimal in-memory localStorage (after the imports — ESM evaluates
   imports first, and none of these modules read storage at import time). Run via
   `npm test`. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { capMessages, mergeMessages, estimateBytes } from '../public/webclient/cache.js';
import { addIntent, removeIntent, drainList } from '../public/webclient/syncqueue.js';
import { isValidId, safeId } from '../public/webclient/validate.js';
import { shapePerf } from '../public/webclient/telemetry.js';

globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

// ---- cache: capMessages / mergeMessages / estimateBytes -------------------
test('capMessages keeps newest N durable messages, drops pending + temp bubbles', () => {
  const msgs = [
    { id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 },
    { id: 'tmp-x', createdAt: 3 }, { id: 'c', createdAt: 4, pending: true },
    { id: 'd', createdAt: 5 },
  ];
  assert.deepEqual(capMessages(msgs, 2).map((m) => m.id), ['b', 'd']);
});

test('capMessages tolerates non-arrays', () => {
  assert.deepEqual(capMessages(null), []);
  assert.deepEqual(capMessages(undefined), []);
});

test('mergeMessages de-dupes by id (fresh wins) and sorts ascending', () => {
  const cached = [{ id: 'a', createdAt: 1, body: 'old' }, { id: 'b', createdAt: 3 }];
  const fresh = [{ id: 'a', createdAt: 1, body: 'new' }, { id: 'c', createdAt: 2 }];
  const out = mergeMessages(cached, fresh);
  assert.deepEqual(out.map((m) => m.id), ['a', 'c', 'b']);
  assert.equal(out.find((m) => m.id === 'a').body, 'new');
});

test('estimateBytes is positive for objects and 0 for undefined', () => {
  assert.ok(estimateBytes({ a: 'hello world' }) > 0);
  assert.equal(estimateBytes(undefined), 0);
});

// ---- syncqueue: addIntent / removeIntent / drainList ----------------------
test('addIntent collapses repeated reads per chat (latest ts wins)', () => {
  let q = addIntent({}, 'read', 'c1', 100);
  q = addIntent(q, 'read', 'c1', 50);
  assert.equal(q.read.c1, 100);
});

test('addIntent: a read supersedes a queued delivered', () => {
  let q = addIntent({}, 'delivered', 'c1', 10);
  assert.equal(q.delivered.c1, 10);
  q = addIntent(q, 'read', 'c1', 20);
  assert.equal(q.delivered.c1, undefined);
  assert.equal(q.read.c1, 20);
});

test('addIntent: delivered is ignored once a read is queued', () => {
  let q = addIntent({}, 'read', 'c1', 20);
  q = addIntent(q, 'delivered', 'c1', 30);
  assert.equal(q.delivered.c1, undefined);
  assert.equal(q.read.c1, 20);
});

test('addIntent ignores unknown kinds and empty chat ids', () => {
  assert.deepEqual(addIntent({}, 'bogus', 'c1'), { read: {}, delivered: {} });
  assert.deepEqual(addIntent({}, 'read', ''), { read: {}, delivered: {} });
});

test('drainList orders reads before delivereds; removeIntent drops one', () => {
  let q = addIntent({}, 'read', 'c1', 1);
  q = addIntent(q, 'delivered', 'c2', 1);
  assert.deepEqual(drainList(q),
    [{ kind: 'read', chatId: 'c1' }, { kind: 'delivered', chatId: 'c2' }]);
  q = removeIntent(q, 'read', 'c1');
  assert.deepEqual(drainList(q), [{ kind: 'delivered', chatId: 'c2' }]);
});

// ---- validate: isValidId / safeId -----------------------------------------
test('isValidId accepts uuid/hex ids and rejects path/query tricks', () => {
  assert.ok(isValidId('550e8400-e29b-41d4-a716-446655440000'));
  assert.ok(isValidId('abc_DEF-123'));
  assert.equal(isValidId('../etc/passwd'), false);
  assert.equal(isValidId('a/b'), false);
  assert.equal(isValidId('a?b=1'), false);
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('x'.repeat(65)), false);
  assert.equal(isValidId(123), false);
});

test('safeId returns the id when valid, otherwise null', () => {
  assert.equal(safeId('good-id_1'), 'good-id_1');
  assert.equal(safeId('bad/id'), null);
});

// ---- telemetry: shapePerf -------------------------------------------------
test('shapePerf reduces navigation + paint timing to rounded ms', () => {
  const nav = {
    responseStart: 12.4, domContentLoadedEventEnd: 120.6, domInteractive: 100.2,
    loadEventEnd: 200.9, transferSize: 2048,
  };
  const paint = [{ name: 'first-contentful-paint', startTime: 90.7 }];
  assert.deepEqual(shapePerf(nav, paint), {
    ttfb: 12, domContentLoaded: 121, domInteractive: 100, load: 201, fcp: 91, transferKb: 2,
  });
});

test('shapePerf returns null without a navigation entry', () => {
  assert.equal(shapePerf(null), null);
});

test('shapePerf nulls negative/absent values but keeps a real 0', () => {
  const p = shapePerf({ responseStart: -1, domInteractive: 0 }, []);
  assert.equal(p.ttfb, null);
  assert.equal(p.domInteractive, 0);
  assert.equal(p.fcp, null);
  assert.equal(p.transferKb, null);
});
