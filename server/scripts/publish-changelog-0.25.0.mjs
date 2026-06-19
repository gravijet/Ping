/* One-shot: publish the 0.25.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.25.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Benachrichtigungen – jetzt auch außerhalb von Ping

- **Im Browser: Benachrichtigungen, selbst wenn der Tab zu ist** — aktiviere unter *Einstellungen → Mitteilungen → „Push (auch bei geschlossenem Tab)"* echte System-Hinweise. Ping meldet sich dann bei neuen Nachrichten, auch wenn der Tab oder der ganze Browser geschlossen ist.
- **Direkt aus der Benachrichtigung antworten (Android)** — tippe deine Antwort gleich im Benachrichtigungs-Feld, ohne Ping zu öffnen. Oder markiere den Chat mit einem Tippen als **gelesen**.
- **Schnellzugriffe am Startbildschirm (Android)** — halte das Ping-Symbol gedrückt und spring direkt in einen deiner letzten Chats.
- **Schnelleinstellungen-Kachel (Android)** — eine „Ping stummschalten"-Kachel im Schnellzugriff legt Benachrichtigungen für eine Stunde schlafen.
- **Symbol-Zähler** — installierst du Ping als App, zeigt das Symbol jetzt die Zahl der ungelesenen Nachrichten direkt am Betriebssystem.

## Windows

- **Aktionen direkt in der Benachrichtigung** — „Öffnen" und „Als gelesen" gleich auf der Windows-Benachrichtigung.
- **„Nicht stören" im Infobereich** — Benachrichtigungen mit einem Klick aus dem Tray stummschalten.

## Datenschutz & Technik

- Web Push ist **komplett ohne fremde Dienste** umgesetzt (Verschlüsselung nach RFC 8291, Anmeldung per VAPID) – die geheimen Schlüssel verlassen nie den Server.
- Die Antwort-aus-der-Benachrichtigung nutzt deine bestehende, sichere Anmeldung über HTTPS – kein zusätzliches Geheimnis.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.25.0 — Benachrichtigungen überall',
  version: '0.25.0',
  tag: 'feature',
  summary:
    'Ping erreicht dich jetzt auch außerhalb der App: im Browser echte Push-Benachrichtigungen, ' +
    'selbst wenn der Tab geschlossen ist; auf Android direkt aus der Benachrichtigung antworten ' +
    'oder als gelesen markieren, plus Startbildschirm-Schnellzugriffe und eine Stummschalt-Kachel; ' +
    'auf Windows Toast-Aktionen und „Nicht stören". Dazu ein Ungelesen-Zähler am App-Symbol.',
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
