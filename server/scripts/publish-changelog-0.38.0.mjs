/* One-shot: publish the 0.38.0 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.38.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Universum — das bisher größte Update

Zehn ganz neue Nachrichten-Arten und jede Menge mehr. Am besten auf **Web & Windows**.

- **🎨 Whiteboard**: Gemeinsam in Echtzeit zeichnen – jeder Strich erscheint sofort bei allen.
- **📄 Dokument**: Ein geteiltes Mini-Dokument, das ihr zusammen bearbeiten könnt.
- **🎵 Playlist**: Eine gemeinsame Titelliste – „Listen Together".
- **🍳 Rezept**: Teile ein Rezept mit Zutaten und Schritten als hübsche Karte.
- **🃏 Lernkarten**: Ein Karteikarten-Deck zum Lernen und Abfragen.
- **📝 Formular**: Mehrere Fragen auf einmal (Text/Auswahl/Bewertung) mit Live-Ergebnis.
- **🔖 Lesezeichen** & **🗺️ Orte**: Sammelt Links bzw. Lieblingsorte als Karte.
- **⭕ Videonotiz** & **🍿 Kinoabend**: Runde Kurzvideos und synchrones Video-Schauen.
- **🎁 Geschenke**: Verschick ein animiertes Geschenk mit Konfetti.

Dazu: **🎙️ Sprach-Räume**, **Einladungslinks** für Gruppen, ein **lokaler @ping-Assistent**
(läuft komplett auf dem Server, keine Cloud), **Erfolge & Streaks**, ein **Gewohnheits-Tracker**
und ein **vereinter Kalender**, der Termine, Erinnerungen und geplante Anrufe an einem Ort zeigt.

Die Android-App zeigt die neuen Inhalte als Karte mit „In der Web-/Desktop-App öffnen" — die
volle, interaktive Ansicht gibt es auf Web und Desktop.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.38.0 — Universum',
  version: '0.38.0',
  tag: 'feature',
  summary:
    'Mega-Release: zehn neue Nachrichten-Arten (Whiteboard, Dokument, Playlist, '
    + 'Rezept, Lernkarten, Formular, Lesezeichen, Orte, Videonotiz, Kinoabend) plus '
    + 'Geschenke, Sprach-Räume, Einladungslinks, lokaler Assistent, Erfolge & Streaks, '
    + 'Gewohnheits-Tracker und ein vereinter Kalender.',
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
