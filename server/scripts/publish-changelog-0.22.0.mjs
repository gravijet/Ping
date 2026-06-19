/* One-shot: publish the 0.22.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.22.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Offline-First – Ping bleibt lesbar, auch ohne Netz

- **Sofort da** — Ping merkt sich deine Chatliste und die letzten Nachrichten je Chat (im Gerätespeicher) und zeigt sie beim Start **sofort** an – sogar offline. Sobald wieder Verbindung besteht, gleichen sich die Live-Daten ab.
- **Alte Gespräche offline lesen** — öffnest du einen Chat ohne Verbindung, ist sein Verlauf trotzdem da.
- **Sicher pro Konto** — der Offline-Cache gehört nur deinem Konto und wird beim Abmelden gelöscht.
- **Nichts geht verloren** — „gelesen/zugestellt", die während eines Verbindungsabbruchs nicht ankamen, werden gepuffert und automatisch nachgereicht.

## Feinschliff im Chat

- **„Neue Nachrichten"-Trenner** — kommen Nachrichten herein, während du weiter oben liest, markiert ein Trenner die erste neue.
- **Zähler am Nach-unten-Knopf** — der Springen-Knopf zeigt jetzt, wie viele neue Nachrichten unten warten.
- **Sanftere Übergänge** — dezente Einblendungen beim Wechsel zwischen Chats und Bereichen (respektiert „Reduzierte Bewegung").

## Dein Look

- **AMOLED-Schwarz** — ein echtes Schwarz für das dunkle Design, das OLED-Displays schont. Umschaltbar in **Einstellungen → Design**.

## Teilen & Tempo

- **Profil-Links** — teile einen Link, der direkt die Profilkarte einer Person öffnet und „Nachricht senden" anbietet.
- **Schneller** — Bilder werden erst beim Sichtbarwerden geladen, selten genutzte Bereiche im Hintergrund vorbereitet.

## Für Tüftler

- Das Entwickler-Panel zeigt nun **Leistungswerte**, einen **Cache-Inspektor** und einen **„Offline simulieren"**-Schalter.

Die Windows-App umhüllt Ping Web – sie bekommt **alle** Neuerungen oben automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.22.0 — Offline, Tempo & Feinschliff',
  version: '0.22.0',
  tag: 'feature',
  summary: 'Ping wird echt offline-first: Chatliste & letzte Nachrichten werden lokal vorgehalten und ' +
    'sofort beim Start angezeigt, Lesebestätigungen überstehen Verbindungsabbrüche. Dazu ein AMOLED-' +
    'Schwarz-Design, teilbare Profil-Links, schnelleres Laden (Lazy-Bilder, Vorabladen) und mehr ' +
    'Entwickler-Werkzeuge. Die Windows-App erbt alles.',
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
