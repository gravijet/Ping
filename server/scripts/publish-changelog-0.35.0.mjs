/* One-shot: publish the 0.35.0 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.35.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Ausdruck & Werkbank

Zwei neue Wege, dich auszudrücken – auf Web, Windows und Android.

- **Kontaktkarten**: Teile eine Person als schicke Karte mit Name, @Handle und Foto. Ein Tippen auf **„Chat starten"** öffnet direkt das Gespräch. Über das 📎-Menü unter **Kontakt**.
- **Code-Snippets**: Teile Code als Karte mit **Syntax-Hervorhebung**, Sprach-Label und **Ein-Tipp-Kopieren** – inklusive Vollbild-Ansicht mit Kopieren & Speichern. Über das 📎-Menü unter **Code**.
- **Feinschliff**: sanftere Karten-Animationen und ruhigere Ladezustände (mit Rücksicht auf „Bewegung reduzieren").

Beides ist sofort durchsuchbar – z. B. \`typ:kontakt\` oder \`typ:code\` in der Suche.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.35.0 — Ausdruck & Werkbank',
  version: '0.35.0',
  tag: 'feature',
  summary:
    'Zwei neue Nachrichten-Typen: Kontaktkarten (teile eine Person als '
    + 'tippbare Karte mit „Chat starten") und Code-Snippets (mit '
    + 'Syntax-Hervorhebung, Kopieren und Vollbild-Ansicht) — plus etwas '
    + 'UI-Feinschliff. Auf Web, Windows und Android.',
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
