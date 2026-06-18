/* One-shot: publish the 0.20.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog).
   Run from anywhere: node server/scripts/publish-changelog-0.20.0.mjs        */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Ping Web & Windows — jetzt offline-fähig

- **Als App installieren** — Ping Web lässt sich wie eine echte App installieren und startet künftig auch **ohne Internet**.
- **Offline lesen** — deine Chats und die zuletzt geöffneten Unterhaltungen sind auch ohne Verbindung da.
- **Offline schreiben** — getippte Nachrichten gehen nicht verloren: sie warten als „⧗ ausstehend" und werden **automatisch gesendet**, sobald du wieder verbunden bist.
- **Automatischer Wiederversand** — sobald die Verbindung zurück ist, stellt Ping wartende Nachrichten von selbst zu.
- **Erneut versuchen** — eine fehlgeschlagene Nachricht kannst du mit einem Tipp auf das Häkchen erneut senden.
- **Verbindungs-Hinweis** — eine dezente Leiste zeigt „offline" oder „Verbindung wird wiederhergestellt", statt dass die App stillschweigend hakt.

## Schneller & runder

- **Sanftere Ladeanzeigen** — schimmernde Platzhalter für Chatliste und Verlauf statt leerer Flächen oder eines verfrühten „Keine Chats".
- **Kein Flackern mehr** — die Chatliste zeigt nicht länger kurz „Keine Chats", bevor sie geladen ist.
- **Klarere Status-Häkchen** — „wird gesendet" (Uhr) und „fehlgeschlagen" lassen sich jetzt von gesendet / zugestellt / gelesen unterscheiden.
- **Schnellerer Start** — die App-Hülle wird zwischengespeichert und lädt beim nächsten Mal sofort.
- **Reduzierte Bewegung** wird überall respektiert (auch bei den neuen Animationen).

## Teilen & Einladen

- **Nachricht teilen** — über das System-Teilen-Menü oder die Zwischenablage.
- **Chat-Link teilen** — ein geteilter Link öffnet das Gespräch direkt (\`?chat=\`).
- **Freunde einladen** — neuer Einladen-Eintrag in Menü, Befehls-Palette und Einstellungen.

## Für Entwickler & Technikbegeisterte

- **Debug- & Diagnose-Panel** — mit **Strg/⌘ + ⇧ + D** (oder über Einstellungen → Datenschutz): Verbindung, Speicher-Status, Feature-Schalter, Ereignis-Log, Absturzprotokoll und ein API-Inspektor.
- **Feature-Flags** — Funktionen lassen sich live ein-/ausschalten, ohne neu zu veröffentlichen.
- **API-Inspektor** — zeigt die letzten Anfragen (Methode, Pfad, Status, Dauer) — ohne Inhalte oder Zugangsdaten.
- **Diagnose kopieren** — ein Klick legt einen anonymen Statusbericht in die Zwischenablage.

## Datenschutz zuerst

- **Diagnose & Absturzberichte sind optional** und standardmäßig **aus** — Ping bleibt seinem „kein Tracking"-Versprechen treu.
- **Anonym** — falls aktiviert, werden nur anonyme Kennzahlen gesendet: **keine** Nachrichteninhalte, **keine** Konto-ID.
- **Lokal zuerst** — das Absturzprotokoll bleibt auf deinem Gerät, solange du nichts anderes wählst.
- **Nichts im Cache, was privat ist** — der Offline-Speicher enthält nie deine Nachrichten oder Medien, nur die App-Hülle.

## Unter der Haube

- **Server-Diagnose** — neue, streng geprüfte und gedeckelte Endpunkte für anonyme Diagnose und Absturzberichte.
- **Admin-Übersicht** — Admins sehen die häufigsten Ereignisse und die letzten Fehlerberichte im Konsolen-/Web-Portal.
- **Durchgehende Tests & CI** — Server-Tests, ein Web-Client-Smoke-Test und Flutter-Analyse laufen automatisch bei jeder Änderung.
- **Build-Pipelines** für Android und Windows in GitHub Actions.

Die Windows-App umhüllt Ping Web — sie bekommt **alle** Verbesserungen oben automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.20.0 — offline-fähig, flüssiger & mit Entwickler-Werkzeugen',
  version: '0.20.0',
  tag: 'feature',
  summary: 'Ping Web wird zur installierbaren App, die offline läuft: Nachrichten warten offline und ' +
    'werden automatisch gesendet. Dazu Skeleton-Ladeanzeigen, ein Verbindungs-Banner, Teilen-Funktionen, ' +
    'ein Debug-/Diagnose-Panel und optionale, anonyme Diagnose (standardmäßig aus). Die Windows-App erbt alles.',
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
