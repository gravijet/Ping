/* One-shot: publish the 0.21.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog).
   Run from anywhere: node server/scripts/publish-changelog-0.21.0.mjs        */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Erwähnungen, Entwürfe & das Aktivitäts-Center

- **@-Erwähnungen in Gruppen** — tippe \`@\`, um ein Mitglied auszuwählen (mit Pfeiltasten, Enter oder Tab). Erwähnungen werden hervorgehoben; wirst **du** erwähnt, sieht man es besonders.
- **Erwähnt-Abzeichen** — eine Erwähnung markiert den Chat in der Liste mit einem \`@\`, bis du ihn öffnest — in einer lebhaften Gruppe geht so nichts unter.
- **Aktivitäts-Center** — die **Glocke** in der Seitenleiste sammelt, was passiert ist, während du weg warst: Reaktionen auf deine Nachrichten, Erwähnungen, neue Chats und verpasste Anrufe — mit Ungelesen-Zähler.

## Schneller im Alltag

- **Nachrichten-Entwürfe** — angefangener, noch nicht gesendeter Text wird je Chat gemerkt und beim erneuten Öffnen wiederhergestellt. Die Liste zeigt „Entwurf: …".
- **Tastenkürzel-Übersicht** — die Taste **?** zeigt alle Tastenkürzel übersichtlich gruppiert.
- **App-Verknüpfungen** — beim installierten Ping bieten „Neuer Chat" und „Aktivität" jetzt direkte Sprungziele.

## Dein Ping, dein Look

- **Theme Studio** (Einstellungen → Design) — acht fertige Vorlagen mit einem Tipp, eine **eigene Akzentfarbe** und ein teilbarer **\`ping-theme:\`-Code**, mit dem du deinen Look auf andere Geräte mitnimmst.

## Nur für dich, nur auf deinem Gerät

- **Nutzungs-Insights** (Einstellungen → Mehr) — eine 7-Tage-Übersicht deiner gesendeten Nachrichten und dein aktivster Chat. Diese Statistik bleibt **ausschließlich auf deinem Gerät** und wird **niemals gesendet** — ganz im Sinne von „kein Tracking".

## Rund & verlässlich

- **Update-Hinweis** — nach einer neuen Version erscheint ein dezentes „Neu laden" statt eines stillen Austauschs im Hintergrund.
- **Sicher gebaut** — Erwähnungen und importierte Theme-Codes werden streng geprüft, sodass sich darüber nichts einschleusen lässt.

Die Windows-App umhüllt Ping Web — sie bekommt **alle** Neuerungen oben automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.21.0 — Erwähnungen, Entwürfe & Aktivitäts-Center',
  version: '0.21.0',
  tag: 'feature',
  summary: '@-Erwähnungen in Gruppen, ein Aktivitäts-Center für Reaktionen/Erwähnungen/verpasste Anrufe, ' +
    'gespeicherte Nachrichten-Entwürfe pro Chat, ein Theme Studio mit teilbaren Theme-Codes, lokale ' +
    'Nutzungs-Insights (nie gesendet) und eine Tastenkürzel-Übersicht (Taste ?). Die Windows-App erbt alles.',
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
