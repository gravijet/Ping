/* One-shot: publish the 0.28.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.28.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Kontext

Diese Version gibt deinen Nachrichten mehr Kontext – auf **allen** Geräten gleichzeitig (Handy, Web und Windows):

- **🔗 Link-Vorschauen** — teilst du einen Link, zeigt Ping ihn als hübsche Karte mit Titel, Beschreibung, Seitenname und Vorschaubild. Die Vorschau lädt erst, wenn die Nachricht sichtbar wird, wird pro Link **nur einmal** geholt und gespeichert, und spart im Datensparmodus das Bild. Links ohne Infos bleiben einfach ein normaler Link.
- **🕓 Bearbeitungsverlauf** — jede Bearbeitung sichert die vorige Fassung. Tippe auf „bearbeitet" an einer Nachricht, um zu sehen, wie sie sich verändert hat – vom Original bis zur aktuellen Version.

## Datenschutz & Technik

- Link-Vorschauen werden serverseitig **sicher** geholt: interne/private Adressen werden blockiert, es wird nur echtes HTML mit festem Größen- und Zeitlimit gelesen.
- Beide Funktionen lassen sich serverseitig per Funktions-Schalter abschalten.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.28.0 — Kontext',
  version: '0.28.0',
  tag: 'feature',
  summary:
    'Mehr Kontext in deinen Chats – überall: Links werden zu hübschen Vorschau-Karten ' +
    '(mit Titel, Bild & Seitenname, sicher serverseitig geholt), und ein Tippen auf ' +
    '„bearbeitet" zeigt den vollständigen Bearbeitungsverlauf einer Nachricht.',
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
