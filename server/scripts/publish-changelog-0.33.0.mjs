/* One-shot: publish the 0.33.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.33.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Pläne & Aufgaben

Aus jedem Chat wird ein Ort, an dem ihr Dinge **gemeinsam organisiert**.

- **📅 Termine** — plane einen Termin mit Titel, Datum, Ort und Beschreibung direkt im Chat. Alle antworten mit **Zusage, Vielleicht oder Absage**, und du siehst live, wer dabei ist. Ein neuer Bereich **„Termine"** zeigt dir alles Anstehende auf einen Blick – nach Tagen sortiert.
- **⏰ Termin-Erinnerung** — lass dich (und alle Zusagenden) **automatisch** vor dem Start erinnern. Die Erinnerung kommt vom Server, auch wenn die App geschlossen ist.
- **✅ Aufgabenlisten** — teile eine Checkliste im Chat. Jede:r kann Punkte **abhaken**, neue **hinzufügen**, und der **Fortschrittsbalken** füllt sich in Echtzeit auf allen Geräten.

## Technik

- Beide neuen Nachrichten-Typen nutzen dieselbe erprobte Mechanik wie Umfragen – damit sind sie sofort **in Echtzeit, offline-fähig und durchsuchbar** (\`typ:termin\`, \`typ:aufgabe\`).
- Termin-Erinnerungen werden **serverseitig** ausgelöst – genau einmal.
- Neu im **Web & Windows** mit voller Oberfläche; die **Android-App** bekommt die neuen Karten über das automatische Update.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.33.0 — Pläne & Aufgaben',
  version: '0.33.0',
  tag: 'feature',
  summary:
    'Termine mit Zu-/Absage und automatischer Erinnerung samt „Termine"-Übersicht, ' +
    'plus gemeinsame Aufgabenlisten zum Abhaken – beides direkt im Chat, in Echtzeit ' +
    'auf allen Geräten.',
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
