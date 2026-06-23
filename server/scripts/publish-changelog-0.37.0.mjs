/* One-shot: publish the 0.37.0 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.37.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Feinschliff

Viele kleine, feine Neuerungen – am sichtbarsten auf Web & Windows.

- **Sende-Effekte**: Schick eine Nachricht mit **Konfetti**, **Ballons** oder **Herzen** – der Effekt spielt bei dir und der anderen Person. Im Composer über das ✨-Symbol.
- **Quiz-Umfragen**: Markiere bei einer Umfrage die **richtige Antwort** – die Lösung wird erst aufgedeckt, nachdem man selbst abgestimmt hat.
- **Wiederkehrende Erinnerungen**: Lass dich **täglich** oder **wöchentlich** an eine Nachricht erinnern.
- **„Wer hat reagiert"**: Lange auf einen Reaktions-Chip drücken (oder Rechtsklick) zeigt, **wer** reagiert hat.
- **Auto-Übersetzung pro Chat**: Schalte für eine Unterhaltung ein, dass eingehende Nachrichten automatisch übersetzt werden.
- **Smart-Ordner**: Gib einem Ordner ein **Stichwort** – passende Chats sortieren sich von selbst hinein.
- **Diktat**: Sprich deine Nachricht ein (Sprache → Text), direkt im Eingabefeld.
- **Geburtstags-Hinweis**: Ein dezenter Hinweis, wenn ein Kontakt heute Geburtstag hat.

Außerdem: ein **Barrierefreiheits-Durchgang** im Web-Client und ein behobener Fehler, durch den **Umfrage-Stimmen im PC-Client** bisher nicht ankamen.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.37.0 — Feinschliff',
  version: '0.37.0',
  tag: 'feature',
  summary:
    'Acht kuratierte Komfort-Features: Sende-Effekte, Quiz-Umfragen, '
    + 'wiederkehrende Erinnerungen, „Wer hat reagiert", Auto-Übersetzung pro Chat, '
    + 'Smart-Ordner, Diktat und Geburtstags-Hinweise. Plus ein Barrierefreiheits-'
    + 'Durchgang und ein reparierter Umfrage-Bug im Web-Client.',
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
