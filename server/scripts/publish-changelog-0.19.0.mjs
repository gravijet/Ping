/* One-shot: publish the 0.19.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog).
   Run from anywhere: node server/scripts/publish-changelog-0.19.0.mjs        */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Ping Web & Windows
- **Automatisches Design** — Ping kann jetzt deinem System folgen und wechselt von selbst zwischen Hell und Dunkel. Du wählst zwischen *Automatisch*, *Hell* und *Dunkel*.
- **Einstellungen sichern & wiederherstellen** — speichere Design, Akzentfarbe und dein Verhalten als kleine Datei und übertrage sie mit einem Klick auf einen anderen Browser oder PC.
- **Mehr Barrierefreiheit** — Links lassen sich dauerhaft unterstreichen und Schaltflächen vergrößern; dazu hoher Kontrast und reduzierte Bewegung.
- Aufgeräumte Bedienung: Befehls-Palette (Strg/⌘ + K), Geräte-Verknüpfung, App-Sperre per PIN, Medien-Galerie, Zeichnen und ein neues Info-Panel.

## Android
- **Anrufton** — das Klingeln bei ein- und ausgehenden Anrufen lässt sich jetzt getrennt ein- und ausschalten.

## Website & Status
- **Besser zugänglich** — „Zum Inhalt springen", ein klar sichtbarer Tastatur-Fokus und korrekte Hinweise für Screenreader auf der ganzen Seite.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.19.0 — mehr Einstellungen, schöner & barrierefreier',
  version: '0.19.0',
  tag: 'feature',
  summary: 'Automatisches Hell-/Dunkel-Design, Sichern & Wiederherstellen deiner Einstellungen, ' +
    'neue Barrierefreiheits-Optionen sowie ein getrennt schaltbarer Anrufton auf Android.',
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
