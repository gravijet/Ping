/* One-shot: publish the 0.36.1 changelog post via the CF-Access-free console
   bridge. Run: node server/scripts/publish-changelog-0.36.1.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## „App nicht installiert" beim Neuinstallieren behoben

Manche Geräte zeigten beim **Neuinstallieren oder Aktualisieren** sporadisch *„App
nicht installiert"* — mal nach mehreren Versuchen, auf einzelnen Modellen (z. B.
Samsung Galaxy A55) gar nicht. Das ist jetzt gefixt.

- Die App-Pakete tragen ab sofort **alle dieselbe Versionsnummer**, egal ob du sie
  von der Website lädst oder per In-App-Update bekommst. Damit lässt sich jede
  Variante sauber über jede andere installieren — kein „Downgrade" mehr, das Android
  blockiert.
- Geräte, die wegen des alten Fehlers festhingen, können sich mit **diesem** Update
  wieder ganz normal aktualisieren.

Rein technisches Update — an den Funktionen ändert sich nichts.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.36.1 — Neuinstallation repariert',
  version: '0.36.1',
  tag: 'fix',
  summary:
    'Behebt das sporadische „App nicht installiert" beim Neuinstallieren/Updaten '
    + '(auf manchen Geräten, z. B. Samsung A55, ging es gar nicht). Alle App-Pakete '
    + 'tragen jetzt dieselbe Versionsnummer, sodass jede Variante sauber über jede '
    + 'andere installiert. Reines Android-Update.',
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
