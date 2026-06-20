/* One-shot: publish the 0.27.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.27.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Ordnung & Ausdruck

Diese Version bringt vier neue Funktionen, die deine Chats übersichtlicher machen – auf **allen** Geräten gleichzeitig (Handy, Web und Windows):

- **📌 Nachrichten anpinnen** — pinne wichtige Nachrichten an, damit alle im Chat sie oben in einem Banner sehen. Tippe auf das Banner, um zur Nachricht zu springen (und durch mehrere Pins zu blättern), und löse sie mit einem Tippen wieder. Bis zu 50 pro Chat.
- **🗂️ Chat-Ordner** — gruppiere deine Unterhaltungen in eigene Ordner („Arbeit", „Familie" …) und filtere die Chatliste mit einem Tippen. Ordner und ihre Zuordnung synchronisieren sich über all deine Geräte.
- **⭐ Gespeicherte Nachrichten – jetzt geräteübergreifend** — was du markierst, ist nun auf dem Server gesichert und taucht auf deinen anderen Geräten und im Web wieder auf.
- **✍️ Entwürfe folgen dir** — ein angefangener Text wird (sparsam) mit dem Server abgeglichen und steht auf deinem nächsten Gerät bereit. Funktioniert weiterhin auch offline.

## Außerdem

- **🔍 In diesem Chat suchen** — die Suche kann jetzt gezielt eine einzelne Unterhaltung durchsuchen.
- Die Filterleiste über der Chatliste fasst die Schnellfilter und deine Ordner zusammen und lässt sich seitlich scrollen.

## Datenschutz & Technik

- Alle neuen Funktionen sind sauber abgesichert: jede Anfrage wird geprüft, und ein Ordner kann nur deine eigenen Chats enthalten – nie fremde.
- Diese Aktualisierung bringt auch die zuvor nur intern vorhandenen **0.26.0**-Verbesserungen (Diagnose, „Deine Statistik", Entwickleroptionen) auf dein Gerät.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.27.0 — Ordnung & Ausdruck',
  version: '0.27.0',
  tag: 'feature',
  summary:
    'Mehr Ordnung in deinen Chats – überall: angepinnte Nachrichten mit Banner, ' +
    'eigene Chat-Ordner als Filter, geräteübergreifend gespeicherte Nachrichten und ' +
    'synchronisierte Entwürfe. Dazu eine gezielte Suche „in diesem Chat". Bringt auch ' +
    'die Diagnose- und Statistik-Funktionen aus 0.26.0 auf dein Gerät.',
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
