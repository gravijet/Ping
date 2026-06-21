/* One-shot: publish the 0.34.1 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.34.1.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## „Alles" – jetzt auch nativ auf Android

Die großen 0.34.0-Neuerungen kommen mit diesem Update voll in der Android-App an.

- **Sticker, Boards, Spiele & Live-Standort** werden jetzt direkt im Chat angezeigt – und sind **antippbar**: Karten verschieben/hinzufügen, **Tic-Tac-Toe** und **Vier gewinnt** spielen, den Live-Standort auf der Karte öffnen.
- **Einmal ansehen**: Fotos einmalig öffnen, danach sind sie weg.
- **Termine & Aufgaben**: zu-/absagen und Punkte abhaken – mit Live-Fortschritt.
- **Threads**: tippe auf „X Antworten", um den Gesprächsfaden zu öffnen.
- **Sprachnachrichten** zeigen ihr (auf dem Server erstelltes) Transkript.
- **Screenshot-Hinweis**: Ab Android 14 wird im Chat vermerkt, wenn ein Screenshot gemacht wird.
- **Gruppenanrufe (Beta)**: Sprach-/Videoanrufe zu mehreren, direkt aus einer Gruppe.

Alles über das 📎-Menü erstellbar (Termin, Aufgaben, Board, Spiel, Anruf planen).`;

const post = {
  kind: 'changelog',
  title: 'Version 0.34.1 — Alles, nativ auf Android',
  version: '0.34.1',
  tag: 'improvement',
  summary:
    'Die 0.34.0-Funktionen kommen nativ in die Android-App: Sticker, Boards, '
    + 'Mini-Spiele, Live-Standort, Einmal-ansehen, Termine/Aufgaben, Threads und '
    + 'Sprach-Transkripte werden jetzt angezeigt und sind interaktiv — plus '
    + 'Screenshot-Hinweis (Android 14+) und Gruppenanrufe (Beta).',
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
