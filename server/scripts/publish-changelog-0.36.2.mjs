/* One-shot: publish the 0.36.2 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.36.2.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Update-Installation jetzt verlässlich

Nach dem Versions-Fix in 0.36.1 ist jetzt auch die **Installation selbst** robust —
das sporadische „App nicht installiert" beim Update sollte damit der Vergangenheit
angehören.

- Die App installiert das Update jetzt über das **moderne Installations-Verfahren**
  von Android, statt die Datei nur an das System zu „übergeben". Das ist deutlich
  zuverlässiger – besonders auf Samsung-Geräten.
- **Wenn doch mal etwas blockiert**, sagt dir die App jetzt **warum** und was zu tun
  ist – z. B. dass **Samsung „Auto Blocker"** (Einstellungen → Sicherheit) die
  Installation verhindert und kurz ausgeschaltet werden muss.

Reines Android-Update – an den Funktionen ändert sich nichts.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.36.2 — Verlässliche Installation',
  version: '0.36.2',
  tag: 'fix',
  summary:
    'Macht die Update-Installation selbst zuverlässig (PackageInstaller-Session '
    + 'statt ACTION_VIEW), besonders auf Samsung. Schlägt es doch fehl, zeigt die '
    + 'App jetzt den echten Grund — z. B. „von Auto Blocker / Play Protect '
    + 'blockiert". Reines Android-Update.',
  body,
  published: true,
};

const res = await fetch('http://localhost:61337/api/console/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
  body: JSON.stringify(post),
});
const text = await res.text();
console.log(res.status, text.slice(0, 400));
process.exit(res.ok ? 0 : 1);
