/* One-shot: publish the 0.36.0 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.36.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Zusammen

Zwei neue Wege, euch zu koordinieren – Geld und Termine. Auf Web, Windows und Android.

- **Geteilte Kasse**: Teile eine Ausgabe (z. B. Pizza) **gleichmäßig** oder mit **eigenen Anteilen**. Jeder Chat bekommt eine **Kasse** mit Salden pro Person und den **kürzesten Ausgleichsvorschlägen** – plus **„Begleichen"** mit einem Tipp. Die neue **„Kasse"**-Ansicht zeigt überall, wo du Geld bekommst oder schuldest. Über das 📎-Menü unter **Ausgabe teilen**.
- **Terminfindung**: Schlage **mehrere Zeiten** vor; alle stimmen mit **✅ / 🤔 / ✖️** ab. Der Favorit wird hervorgehoben, und die Organisatorin **legt den Termin fest** – daraus wird automatisch ein echter **Termin** mit Zu-/Absage und Erinnerung. Über das 📎-Menü unter **Terminfindung**.

Beides ist sofort durchsuchbar – z. B. \`typ:kasse\` oder \`typ:terminfindung\` in der Suche.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.36.0 — Zusammen',
  version: '0.36.0',
  tag: 'feature',
  summary:
    'Zwei neue Nachrichten-Typen zum Koordinieren: Geteilte Kasse (Ausgaben '
    + 'splitten mit Salden + Ein-Tipp-Ausgleich) und Terminfindung '
    + '(Verfügbarkeits-Abstimmung, die zum echten Termin wird). '
    + 'Auf Web, Windows und Android.',
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
