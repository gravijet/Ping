/* One-shot: publish the 0.24.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.24.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Neu: Geräte & Diagnose (Android)

- **Alles über dein Gerät auf einen Blick** — unter *Einstellungen → Geräte & Diagnose* siehst du jetzt live Akku (inkl. Temperatur, Zustand und Spannung), Netzwerk, Arbeits- und Gerätespeicher sowie System- und Kernel-Infos – übersichtlich und in Echtzeit.
- **Schlau mit Akku & Datenvolumen** — ist dein Akku fast leer, der Energiesparmodus an oder du im getakteten Mobilfunk, hält Ping große automatische Downloads von selbst zurück.
- **Spürbar besseres Feedback** — kurze, klar unterscheidbare Vibrationen beim Senden und bei Fehlern, direkt über die System-Vibration.

## Neu im Web

- **„Gerät“-Bereich in den Einstellungen** — Akku, Verbindung (inkl. Datensparmodus), Speicherplatz, RAM und CPU-Kerne, soweit dein Browser sie bereitstellt.
- **Datensparend** — im Datensparmodus oder bei langsamer Verbindung lädt Ping nichts unnötig im Hintergrund vor.

## Datenschutz bleibt Datenschutz

- Die anonyme Geräte-Zusammenfassung (z. B. Akku-Bereich, Verbindungsart) wird **nur grob gerundet** und **nur mit deiner Zustimmung** übertragen – nie Rohwerte, nie etwas Persönliches.

## Kleinigkeiten

- Die in den Einstellungen angezeigte Version war veraltet – jetzt stimmt sie wieder.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.24.0 — Geräte & Diagnose',
  version: '0.24.0',
  tag: 'feature',
  summary: 'Ping liest jetzt die echten Gerätewerte – Akku, Temperatur, Netzwerk, Speicher und System – ' +
    'und zeigt sie live unter „Geräte & Diagnose“. Damit schont Ping bei wenig Akku oder im Mobilfunk ' +
    'automatisch Daten und Energie, und gibt klareres Vibrations-Feedback. Auch das Web bekommt einen ' +
    '„Gerät“-Bereich. Anonyme Geräte-Infos nur grob gerundet und nur mit Zustimmung.',
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
