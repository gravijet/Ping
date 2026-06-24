// Bug-fix campaign Phase 3: flag-parity guard. The web client resolves a flag as
// localOverride -> remote (server /api/config) -> DEFAULTS. A flag referenced via
// flag('x') that is missing from DEFAULTS silently resolves to FALSE whenever the
// remote config hasn't loaded yet (offline / first paint) — a real, invisible bug.
// This test fails if any gated flag lacks a built-in default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'webclient'
);

function defaultFlagNames() {
  const src = readFileSync(path.join(webDir, 'flags.js'), 'utf8');
  // The DEFAULTS object body only — so flag('name') in the docstring/examples and
  // the flag(name) parameter don't get mistaken for declared defaults.
  const body = src.match(/export const DEFAULTS = \{([\s\S]*?)\n\};/);
  assert.ok(body, 'DEFAULTS object not found in flags.js');
  return new Set([...body[1].matchAll(/^\s*([a-zA-Z0-9_]+)\s*:\s*(?:true|false)/gm)].map((m) => m[1]));
}

test('every flag() referenced in the web client has a DEFAULTS entry', () => {
  const defaults = defaultFlagNames();
  const offenders = [];
  for (const f of readdirSync(webDir)) {
    if (!f.endsWith('.js') || f === 'flags.js') continue; // skip the flags module itself
    const src = readFileSync(path.join(webDir, f), 'utf8');
    for (const m of src.matchAll(/\bflag\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      if (!defaults.has(m[1])) offenders.push(`${m[1]} (${f})`);
    }
  }
  assert.deepEqual(offenders, [], `flag() names without a DEFAULTS entry: ${offenders.join(', ')}`);
});
