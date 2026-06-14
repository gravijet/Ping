import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

// Automatic database backups. SQLite's `VACUUM INTO` writes a consistent,
// defragmented copy of the whole database to a new file — safe to run while the
// server is live (no need to stop writes). We keep the most recent N snapshots.

function timestamp() {
  const d = new Date();
  const p = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Write one snapshot now and prune old ones. Returns the file path or null. */
export function backupNow() {
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const file = path.join(config.backupDir, `ping-${timestamp()}.db`);
    // VACUUM INTO requires the target not to exist yet.
    if (!fs.existsSync(file)) {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    }
    prune();
    return file;
  } catch (e) {
    console.error('[backup] fehlgeschlagen:', e.message);
    return null;
  }
}

function prune() {
  const files = fs
    .readdirSync(config.backupDir)
    .filter((f) => /^ping-\d{8}-\d{4}\.db$/.test(f))
    .sort(); // lexical sort == chronological for this name format
  const excess = files.length - config.backupKeep;
  for (let i = 0; i < excess; i++) {
    try {
      fs.unlinkSync(path.join(config.backupDir, files[i]));
    } catch {
      /* ignore */
    }
  }
}

/** List existing snapshots (newest first) with size + mtime. */
export function listBackups() {
  try {
    return fs
      .readdirSync(config.backupDir)
      .filter((f) => /^ping-\d{8}-\d{4}\.db$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(config.backupDir, f));
        return { name: f, size: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Resolve a snapshot filename to its absolute path, or null when the name is
 * invalid or the file doesn't exist. Only the exact `ping-YYYYMMDD-HHMM.db`
 * shape is accepted, which also blocks path traversal (no slashes, no `..`).
 */
export function backupFilePath(name) {
  if (typeof name !== 'string' || !/^ping-\d{8}-\d{4}\.db$/.test(name)) {
    return null;
  }
  const base = path.resolve(config.backupDir);
  const full = path.resolve(base, name);
  // Defence in depth: the resolved file must sit directly inside backupDir.
  if (path.dirname(full) !== base) return null;
  return fs.existsSync(full) ? full : null;
}

let timer = null;

/** Start the daily backup scheduler (no-op if disabled). */
export function startBackupScheduler() {
  if (!config.backupEnabled || timer) return;
  // One snapshot shortly after boot, then on the configured interval.
  setTimeout(() => backupNow(), 10_000).unref();
  timer = setInterval(() => backupNow(), config.backupIntervalMs);
  timer.unref();
  console.log(
    `[backup] täglich aktiv → ${config.backupDir} (${config.backupKeep} Snapshots)`
  );
}
