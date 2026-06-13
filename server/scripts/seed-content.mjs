#!/usr/bin/env node
// Seed the newsroom + changelog with a starter set of posts via the admin API.
// Idempotent: posts whose title already exists are skipped, so it's safe to
// re-run. Reads ADMIN_TOKEN + PORT from the environment (or server/.env).
//
//   cd server && node scripts/seed-content.mjs
//   # or against a remote host:
//   BASE=https://example.invalid ADMIN_TOKEN=… node scripts/seed-content.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Pull ADMIN_TOKEN / PORT out of server/.env if not already in the environment.
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = fs.readFileSync(path.join(here, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — rely on the process environment */
  }
  return env;
}

const env = loadEnv();
const TOKEN = env.ADMIN_TOKEN;
const BASE = env.BASE || `http://127.0.0.1:${env.PORT || 61337}`;
if (!TOKEN) {
  console.error('❌ ADMIN_TOKEN fehlt (in server/.env oder als Umgebungsvariable).');
  process.exit(1);
}

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const POSTS = [
  {
    kind: 'news',
    category: 'Unternehmen',
    title: 'Ping hat ein neues Zuhause: example.invalid',
    summary: 'Wir ziehen auf unsere neue Hauptadresse um – die alte funktioniert natürlich weiter.',
    body:
      '## Neue Hauptadresse\nPing ist ab sofort unter **example.invalid** erreichbar.\n\n' +
      '- Die bisherige Adresse *example.invalid* funktioniert weiterhin\n' +
      '- Bestehende Installationen musst du **nicht** anpassen\n' +
      '- Neue Downloads verweisen automatisch auf die neue Adresse\n\n' +
      'Danke, dass du Ping nutzt. 💙',
  },
  {
    kind: 'news',
    category: 'Produkt',
    title: 'Newsroom & Changelog sind da',
    summary: 'Ab jetzt findest du alle Neuigkeiten und jede Änderung übersichtlich auf einer Seite.',
    body:
      '## Mehr Transparenz\nWir teilen ab sofort offen, was wir an Ping bauen.\n\n' +
      '- Der **Newsroom** sammelt Ankündigungen und Geschichten\n' +
      '- Der **Changelog** dokumentiert jede neue Funktion, Verbesserung und Korrektur\n' +
      '- Eine **Status-Seite** zeigt live, ob alle Dienste laufen\n\n' +
      'Schau gern regelmäßig vorbei!',
  },
  {
    kind: 'changelog',
    version: '2.6.0',
    tag: 'feature',
    title: 'Newsroom, Changelog & System-Status',
    summary: 'Die Website und das Admin-Panel wurden umfangreich ausgebaut.',
    body:
      '- **Newsroom** mit Artikeln, Kategorien und Titelbildern\n' +
      '- **Changelog** als gefilterte Timeline nach Version\n' +
      '- Öffentliche **System-Status-Seite** mit Live-Diensten\n' +
      '- **Live-Statistiken** auf der Startseite\n' +
      '- Neue **Inhalte**-Verwaltung im Admin-Panel\n' +
      '- Gemeinsames Design-System für alle Web-Seiten\n' +
      '- Hauptadresse ist jetzt example.invalid',
  },
];

const existing = new Set((await api('/api/admin/posts')).posts.map((p) => p.title));
let created = 0;
for (const post of POSTS) {
  if (existing.has(post.title)) {
    console.log('• übersprungen (existiert):', post.title);
    continue;
  }
  await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(post) });
  console.log('✓ angelegt:', post.title);
  created++;
}
console.log(`\nFertig — ${created} neue${created === 1 ? 'r Beitrag' : ' Beiträge'} angelegt.`);
