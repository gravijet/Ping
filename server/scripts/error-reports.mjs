#!/usr/bin/env node
// error-reports.mjs — the developer side of Fehlerberichte (crash reports).
//
// The clients auto-send crashes to /api/client-error; the server de-duplicates
// them into client_errors as an "open" bug inbox (see telemetryRepo.js). This
// script is how a developer — including a fresh Claude Code session — reads and
// closes that inbox. It opens the live SQLite DB directly (read-only for listing)
// so it works with no server, no auth token and no network.
//
//   node server/scripts/error-reports.mjs            # human-readable open inbox
//   node server/scripts/error-reports.mjs --json     # machine-readable
//   node server/scripts/error-reports.mjs --hook      # session-start banner (quiet if empty)
//   node server/scripts/error-reports.mjs resolve <id|fingerprint> [...]
//   node server/scripts/error-reports.mjs resolve --all
//
// Wired into .claude/scripts/setup.sh so every new session is handed the open
// reports to fix, then closes them with `resolve` once fixed.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- locate the same DB the server uses -----------------------------------
function resolveDbFile() {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = txt.match(/^\s*DB_FILE\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch { /* no .env — fall back */ }
  return fileURLToPath(new URL('../ping.db', import.meta.url));
}
const DB_FILE = resolveDbFile();

function openDb(readOnly) {
  const db = new DatabaseSync(DB_FILE, { readOnly });
  db.exec('PRAGMA busy_timeout = 4000;');
  return db;
}

// True only if the triage columns exist (server has run the migration at least
// once). Lets the script no-op gracefully on a pristine DB.
function ready(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(client_errors)').all().map((c) => c.name);
    return cols.includes('status') && cols.includes('fingerprint');
  } catch { return false; }
}

function fetchOpen(db, limit = 100) {
  return db
    .prepare(
      `SELECT id, fingerprint AS fp, created_at AS createdAt, last_seen AS lastSeen,
              count, app, app_version AS appVersion, context, message, stack, url
       FROM client_errors WHERE status = 'open'
       ORDER BY last_seen DESC, id DESC LIMIT ?`
    )
    .all(limit);
}

// ---- formatting -----------------------------------------------------------
const fmtTime = (ms) => {
  if (!ms) return '?';
  try { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16); }
  catch { return '?'; }
};

function topFrame(stack) {
  return String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || /\.(js|mjs|ts|dart|kt|java)\b/.test(l)) || '';
}

function renderOne(e, full) {
  const head = `[#${e.id}] ${e.app}${e.appVersion ? ` ${e.appVersion}` : ''}` +
    ` · ${e.count}× · zuletzt ${fmtTime(e.lastSeen)} · fp ${e.fp || '—'}`;
  const lines = [head, `  ${e.context ? `(${e.context}) ` : ''}${e.message || '(ohne Meldung)'}`];
  const frame = full ? null : topFrame(e.stack);
  if (full && e.stack) {
    for (const l of String(e.stack).split('\n').slice(0, 12)) lines.push(`    ${l.trim()}`);
  } else if (frame) {
    lines.push(`    ${frame}`);
  }
  if (e.url) lines.push(`    ↪ ${e.url}`);
  return lines.join('\n');
}

// ---- commands -------------------------------------------------------------
function cmdResolve(args) {
  const db = openDb(false);
  if (!ready(db)) { console.error('client_errors not migrated yet — nothing to resolve.'); return 0; }
  let changes = 0;
  if (args.includes('--all')) {
    changes = db.prepare("UPDATE client_errors SET status='resolved', resolved_at=? WHERE status='open'")
      .run(Date.now()).changes;
  } else {
    const refs = args.filter((a) => !a.startsWith('-'));
    if (!refs.length) { console.error('Usage: resolve <id|fingerprint> [...]  |  resolve --all'); return 1; }
    const ph = refs.map(() => '?').join(',');
    changes = db
      .prepare(
        `UPDATE client_errors SET status='resolved', resolved_at=?
         WHERE status='open' AND (id IN (${ph}) OR fingerprint IN (${ph}))`
      )
      .run(Date.now(), ...refs, ...refs).changes;
  }
  console.log(`✓ ${changes} Fehlerbericht(e) als erledigt markiert.`);
  return 0;
}

function cmdList({ json, hook }) {
  let db;
  try { db = openDb(true); } catch {
    if (!hook) console.error(`Konnte DB nicht öffnen: ${DB_FILE}`);
    return hook ? 0 : 1;
  }
  if (!ready(db)) return 0; // pristine DB: silent
  const open = fetchOpen(db);

  if (json) { console.log(JSON.stringify(open, null, 2)); return 0; }

  if (!open.length) {
    if (!hook) console.log('✓ Keine offenen Fehlerberichte.');
    return 0; // hook mode stays quiet when the inbox is empty
  }

  if (hook) {
    const shown = open.slice(0, 5);
    const out = [
      `⚠ ${open.length} offene(r) Fehlerbericht(e) aus der App — bei dieser Session bitte untersuchen und beheben:`,
      '',
      ...shown.map((e) => renderOne(e, false)),
    ];
    if (open.length > shown.length) out.push('', `  … und ${open.length - shown.length} weitere.`);
    out.push(
      '',
      '  Volle Stacks:   node server/scripts/error-reports.mjs',
      '  Nach dem Fix:   node server/scripts/error-reports.mjs resolve <id|fp>   (oder: resolve --all)'
    );
    console.log(out.join('\n'));
    return 0;
  }

  console.log(`${open.length} offene(r) Fehlerbericht(e):\n`);
  console.log(open.map((e) => renderOne(e, true)).join('\n\n'));
  console.log('\nErledigt markieren: node server/scripts/error-reports.mjs resolve <id|fp>');
  return 0;
}

// ---- entry ----------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'resolve') return cmdResolve(argv.slice(1));
  return cmdList({ json: argv.includes('--json'), hook: argv.includes('--hook') });
}

try {
  process.exit(main());
} catch (err) {
  // Never let triage break a session-start hook.
  if (!process.argv.includes('--hook')) console.error('error-reports:', err?.message || err);
  process.exit(0);
}
