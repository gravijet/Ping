/* One-shot: publish the 0.31.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.31.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Gemeinschaft

Ping wird zur Plattform: **öffentliche Kanäle**, die jeder entdecken und denen jeder folgen kann.

- **📢 Kanäle** — erstelle einen Kanal mit Namen, einem eindeutigen **@handle**, Beschreibung und Kategorie. Im Kanal postet nur der/die Betreiber:in – alle anderen **lesen und reagieren**.
- **🧭 Entdecken** — der neue Bereich in der Seitenleiste: durchsuche das nach Abonnenten sortierte **Verzeichnis**, filtere nach Kategorie und folge einem Kanal mit einem Tipp. Vor dem Folgen zeigt eine **Vorschau-Karte** alles Wichtige.
- **🔗 Teilen** — jeder Kanal hat einen Link (\`?c=<handle>\`), den du überall teilen kannst; ein Tipp öffnet die Vorschau zum Folgen.

## Technik

- Ein Kanal ist serverseitig ein öffentlicher Broadcast-Gruppenchat – dadurch funktionieren **Verlauf, Reaktionen, Suche und Push** sofort wie gewohnt.
- Handles sind global eindeutig (Groß-/Kleinschreibung egal). Die Funktion lässt sich serverseitig per Schalter (\`communities\`) abschalten.
- Neu gebaut für **Web & Windows**; die Android-App folgt mit dem Versions-Update und respektiert die Kanal-Regeln automatisch.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.31.0 — Gemeinschaft',
  version: '0.31.0',
  tag: 'feature',
  summary:
    'Öffentliche Kanäle: erstelle einen Kanal mit eindeutigem @handle, entdecke und ' +
    'durchsuche das Verzeichnis im neuen „Entdecken"-Bereich und folge mit einem Tipp. ' +
    'Im Kanal postet nur der/die Betreiber:in – alle anderen lesen und reagieren.',
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
