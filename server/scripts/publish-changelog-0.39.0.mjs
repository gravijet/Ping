/* One-shot: publish the 0.39.0 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.39.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Stabilität — rundum stabiler & sicherer

Diesmal keine neuen Funktionen, sondern Politur unter der Haube: ein gründlicher
Durchgang durch den ganzen Code, der echte Fehler behebt. Web & Windows bekommen
alles sofort; die Android-App ändert sich im Verhalten nicht.

- **Stabiler:** Eine einzelne beschädigte Nachricht kann einen Chat-Verlauf nicht
  mehr „verschlucken" — er lädt zuverlässig weiter.
- **Keine Doppel-Nachrichten mehr**, wenn etwas offline gesendet und später
  automatisch nachgereicht wird.
- **Flüssiger & sparsamer:** mehrere Speicher-Lecks im Web-Client beseitigt, sodass
  langes Hin- und Herwechseln zwischen den Bereichen die App nicht mehr ausbremst.
- **Sicherer:** mehrere Härtungen rund um Push-Benachrichtigungen, Link-Vorschauen
  und die Zwei-Faktor-Wiederherstellungscodes.
- **Barrierefreier:** Dialoge führen die Tastatur-/Screenreader-Fokussierung jetzt
  sauber (Fokus bleibt im Dialog und kehrt beim Schließen zurück).`;

const post = {
  kind: 'changelog',
  title: 'Version 0.39.0 — Stabilität',
  version: '0.39.0',
  tag: 'fix',
  summary:
    'Wartungs- und Härtungs-Release: behebt einen Verlaufs-Absturz bei beschädigten '
    + 'Zeilen, doppelte Nachrichten nach Offline-Retry und mehrere Web-Client-'
    + 'Speicherlecks; dazu Security-Härtungen (Push-SSRF, Link-Preview, 2FA-Codes) '
    + 'und besseres Dialog-Fokus-Management. Web/Windows sofort; Android nur Parität.',
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
