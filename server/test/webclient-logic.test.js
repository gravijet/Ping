/* webclient-logic.test.js — unit tests for the PURE logic in the new 0.21.0
   web-client modules (mentions parsing, theme-code round-trip + sanitising,
   drafts storage, usage-insights tallies). These functions never touch the DOM,
   so we only shim a minimal in-memory localStorage (installed after the imports,
   before any test body runs — ESM evaluates imports first, and none of these
   modules read storage at import time). Run via `npm test`. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenizeMentions, mentionsUser, parseActiveMention, filterMembers,
} from '../public/webclient/mentions.js';
import {
  encodeTheme, decodeTheme, sanitizeTheme,
} from '../public/webclient/themes.js';
import * as drafts from '../public/webclient/drafts.js';
import { recordSent, lastDays, summary, reset } from '../public/webclient/insights.js';

// ---- minimal localStorage (call-time only) --------------------------------
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

const group = {
  type: 'group',
  members: [
    { id: 'u1', displayName: 'Anna' },
    { id: 'u2', displayName: 'Bob Meyer' },
    { id: 'u3', displayName: 'Annabel' },
  ],
};

// ---- mentions -------------------------------------------------------------
test('tokenizeMentions splits text and mentions, longest name wins', () => {
  const toks = tokenizeMentions('Hi @Anna und @Bob Meyer!', group, 'u2');
  const mentions = toks.filter((t) => t.mention).map((t) => t.name);
  assert.deepEqual(mentions, ['Anna', 'Bob Meyer']);
  // 'Bob Meyer' is me (u2) → flagged.
  assert.equal(toks.find((t) => t.name === 'Bob Meyer').me, true);
  assert.equal(toks.find((t) => t.name === 'Anna').me, false);
});

test('tokenizeMentions respects name boundaries (@Anna ≠ @Annabel prefix)', () => {
  const toks = tokenizeMentions('ping @Annabel', group, 'u1');
  // Should match the full member "Annabel", not the shorter "Anna".
  assert.equal(toks.filter((t) => t.mention).length, 1);
  assert.equal(toks.find((t) => t.mention).name, 'Annabel');
});

test('tokenizeMentions in a non-group is a single text token', () => {
  const toks = tokenizeMentions('@Anna hi', { type: 'direct' }, 'u1');
  assert.deepEqual(toks, [{ text: '@Anna hi' }]);
});

test('mentionsUser detects the mentioned member', () => {
  assert.equal(mentionsUser('yo @Bob Meyer', group, 'u2'), true);
  assert.equal(mentionsUser('yo @Bob Meyer', group, 'u1'), false);
  assert.equal(mentionsUser('nothing here', group, 'u2'), false);
});

test('parseActiveMention finds the active @-query, ignores emails', () => {
  assert.deepEqual(parseActiveMention('hello @an', 9), { query: 'an', start: 6 });
  assert.deepEqual(parseActiveMention('@x', 2), { query: 'x', start: 0 });
  assert.equal(parseActiveMention('mail a@b', 8), null);
  assert.equal(parseActiveMention('no at sign', 10), null);
});

test('filterMembers ranks prefix matches first and excludes self', () => {
  const out = filterMembers(group, 'an', 'u3').map((m) => m.displayName);
  assert.deepEqual(out, ['Anna']);            // Annabel excluded as self (u3)
  assert.equal(filterMembers(group, '', 'u1').length, 2); // all but self
});

// ---- theme codes ----------------------------------------------------------
test('encodeTheme/decodeTheme round-trips a full theme', () => {
  const theme = { theme: 'dark', accent: '#ff8a5b', wallpaper: 'sunset',
    bubbleStyle: 'rounded', fontFamily: 'serif' };
  const code = encodeTheme(theme);
  assert.match(code, /^ping-theme:/);
  assert.deepEqual(decodeTheme(code), theme);
});

test('sanitizeTheme drops malformed/unknown values', () => {
  assert.deepEqual(sanitizeTheme({ accent: 'red' }), {});         // not #rrggbb
  assert.deepEqual(sanitizeTheme({ accent: '#fff' }), {});        // 3-digit rejected
  assert.deepEqual(sanitizeTheme({ theme: 'evil' }), {});         // unknown scheme
  assert.deepEqual(sanitizeTheme({ wallpaper: 'javascript:alert(1)' }), {}); // not a real wallpaper
  assert.deepEqual(sanitizeTheme({ accent: '#4d9bff', theme: 'light' }),
    { accent: '#4d9bff', theme: 'light' });
});

test('decodeTheme throws on garbage', () => {
  assert.throws(() => decodeTheme('not-a-code-$$$'));
});

// ---- drafts ---------------------------------------------------------------
test('drafts set / get / has / clear', () => {
  drafts.set('cX', 'tippe gerade …');
  assert.equal(drafts.get('cX'), 'tippe gerade …');
  assert.equal(drafts.has('cX'), true);
  drafts.clear('cX');
  assert.equal(drafts.has('cX'), false);
  assert.equal(drafts.get('cX'), '');
});

test('drafts treats whitespace-only as empty + previews long text', () => {
  drafts.set('cY', '    ');
  assert.equal(drafts.has('cY'), false);
  drafts.set('cY', 'x'.repeat(80));
  assert.ok(drafts.preview('cY', 38).length <= 38);
  assert.ok(drafts.preview('cY').endsWith('…'));
  drafts.clear('cY');
});

// ---- insights -------------------------------------------------------------
test('insights tally records sends for today', () => {
  reset();
  recordSent('c1');
  recordSent('c1');
  recordSent('c2');
  const s = summary();
  assert.equal(s.today, 3);
  assert.equal(s.allTime, 3);
  assert.equal(lastDays(7).at(-1).count, 3);
  assert.equal(s.busiest.chatId, 'c1'); // 2 > 1
  reset();
});
