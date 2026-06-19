/* One-shot: publish the 0.23.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.23.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Updates laufen jetzt im Hintergrund (Android)

- **Weiterladen, auch wenn du wechselst** — startest du ein Update, läuft der Download jetzt **im Hintergrund weiter**, wenn du Ping verlässt, in eine andere App wechselst oder Ping ganz schließt. Kein Abbruch mehr, nur weil du kurz weg bist.
- **Mit Fortschritt im Benachrichtigungsbereich** — Android zeigt den Download als System-Benachrichtigung. Ist er fertig, **tippst du einfach drauf, um zu installieren** – selbst wenn Ping gerade nicht offen ist.
- **Da, wo du aufgehört hast** — öffnest du Ping wieder, knüpft das Update an den laufenden Download an oder bietet die **sofortige Installation** an, falls schon alles geladen ist.
- **Auch mit mobilen Daten** — das Update lädt über WLAN und mobile Daten (auch im Ausland), du wartest nicht aufs nächste WLAN.

## Zuverlässiger

- **Fortsetzen statt neu starten** — reißt die Verbindung mitten im Download ab, geht es danach **dort weiter, wo es war**, statt von vorn zu beginnen.
- **Geprüft vor der Installation** — die heruntergeladene Datei wird weiterhin per Prüfsumme verifiziert, bevor installiert wird.
- **Seltener „App nicht installiert"** — die Installation läuft jetzt über einen zuverlässigeren Weg.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.23.0 — Updates im Hintergrund',
  version: '0.23.0',
  tag: 'feature',
  summary: 'App-Updates laufen auf Android jetzt im Hintergrund weiter – auch wenn du Ping verlässt oder ' +
    'schließt – mit Fortschritt in der Benachrichtigung und Fortsetzen beim erneuten Öffnen. Abgebrochene ' +
    'Downloads setzen fort statt neu zu starten, und die Installation ist zuverlässiger. Die Windows-App erbt alles.',
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
