/* One-shot: publish the 0.32.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.32.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Identität & Schutz

Dein Konto – jetzt einfacher zu finden und besser zu schützen.

- **🔖 Benutzername** — sichere dir einen eindeutigen **@Namen**. Andere finden und schreiben dich darüber, ganz ohne deine Telefonnummer. Dein Profil-Link wird so zu \`?u=@dein-name\`.
- **🛡️ Bestätigung in zwei Schritten** — schütze dein Konto zusätzlich mit einer **Authenticator-App**. Beim Einrichten gibt es **10 Wiederherstellungscodes** für den Notfall. Optional und jederzeit abschaltbar.
- **🔒 Privatsphäre** — entscheide selbst, **wer dir schreiben** und **wer dich zu Gruppen hinzufügen** darf (alle oder nur Kontakte) – und ob du über deinen @Namen auffindbar bist.
- **🧭 Sicherheits-Center** — ein **Protokoll** aller sicherheitsrelevanten Ereignisse (Anmeldungen, 2FA-Änderungen …) und ein Knopf, um dich mit einem Tipp **überall abzumelden**.

## Technik

- Zwei-Faktor-Auth nach Standard (TOTP, RFC 6238) – **ohne zusätzliche Abhängigkeiten**, kompatibel mit Google Authenticator, Aegis, 1Password & Co.
- Privatsphäre-Regeln werden **serverseitig** durchgesetzt, nicht nur in der Oberfläche.
- „Überall abmelden" macht alle anderen Sitzungen sofort ungültig.
- Neu im **Web & Windows** mit voller Oberfläche (Reiter „Sicherheit"); die **Android-App** bekommt den 2FA-Anmeldeschritt, damit niemand ausgesperrt wird.

Die Windows-App umhüllt Ping Web – sie bekommt alle Web-Neuerungen automatisch.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.32.0 — Identität & Schutz',
  version: '0.32.0',
  tag: 'feature',
  summary:
    'Öffentliche @Benutzernamen + Personensuche, Zwei-Faktor-Authentifizierung (TOTP) mit ' +
    'Wiederherstellungscodes, neue Privatsphäre-Regeln (wer darf schreiben / zu Gruppen ' +
    'hinzufügen) und ein Sicherheits-Center mit Protokoll und „überall abmelden".',
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
