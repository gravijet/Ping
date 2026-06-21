/* One-shot: publish the 0.34.0 changelog post via the CF-Access-free console
   bridge (writes to the live DB, served immediately by /api/changelog and the
   in-app "Was ist neu"). Run: node server/scripts/publish-changelog-0.34.0.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = (env.match(/^ADMIN_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!token) { console.error('ADMIN_TOKEN not found in server/.env'); process.exit(1); }

const body = `## Alles — das bisher größte Ping-Update

**25 neue Funktionen** auf einmal, quer durch alle Bereiche. Jede einzeln zu- und abschaltbar.

### 💬 Kommunikation & Anrufe
- **Threads** — antworte gezielt in einem eigenen Gesprächsfaden, ohne den Chat zuzumüllen.
- **Gruppenanrufe** — Sprach-/Videoanrufe zu mehreren.
- **Geplante Anrufe** — verabrede einen Anruf mit automatischer Erinnerung.
- **Live-Standort** — teile deinen Standort für einen Zeitraum, live aktualisiert.
- **Sprachnachricht-Transkription** — Sprachnotizen werden **auf dem eigenen Server** in Text umgewandelt und durchsuchbar.

### 🎨 Medien & Ausdruck
- **Sticker** — eigene Sticker-Pakete anlegen und senden.
- **GIF-Suche** — GIFs direkt im Chat finden (über den Server, privat).
- **Einmal ansehen** — Fotos/Videos, die nach einmaligem Ansehen verschwinden.
- **Chat-Optik** — eigener Hintergrund und Akzentfarbe pro Chat.

### 📋 Produktivität
- **Kanban-Boards** — Aufgaben in Spalten organisieren, gemeinsam in Echtzeit.
- **Mini-Spiele** — Tic-Tac-Toe und Vier gewinnt direkt im Chat.
- **Notizen** — gemeinsame Notiz-Seiten pro Gruppe.
- **Wiederkehrende Termine** — Termine, die sich automatisch wiederholen.
- **Geteilte Inhalte** — alle Bilder, Dateien und Links eines Chats an einem Ort.
- **Webhooks & Bots** — externe Dienste posten direkt in einen Chat.

### 🔒 Sicherheit & Privatsphäre
- **Ende-zu-Ende-Verschlüsselung (Beta)** — für Direktchats, mit Sicherheitsnummer zum Vergleichen.
- **Chat sperren** — einzelne Chats hinter der App-Sperre verstecken.
- **Anmelde-Freigabe** — neue Geräte müssen von einem bestehenden bestätigt werden.
- **Standard-Timer** — neue Chats starten automatisch mit verschwindenden Nachrichten.
- **Screenshot-Hinweis** — informiert den Chat über Screenshots.

### 🤖 Wenig KI – und komplett privat
- **Übersetzung** — Nachrichten übersetzen, über einen **selbst gehosteten** Dienst.
- **„Hol mich ab"** — eine kurze Zusammenfassung des Ungelesenen, rein lokal berechnet.
- **Smart Replies** — passende Schnellantworten als Vorschlag.

> Keine Cloud-KI, keine Datenweitergabe: Übersetzung und Transkription laufen auf dem eigenen Server, der Rest rein auf dem Gerät.

Neu im **Web & Windows** mit voller Oberfläche; die **Android-App** bekommt alle Funktionen über das automatische Update.`;

const post = {
  kind: 'changelog',
  title: 'Version 0.34.0 — Alles',
  version: '0.34.0',
  tag: 'feature',
  summary:
    'Das bisher größte Update: 25 neue Funktionen quer durch alle Bereiche — Threads, '
    + 'Gruppenanrufe, Live-Standort, Sticker, Einmal-ansehen, Boards, Mini-Spiele, '
    + 'Notizen, Webhooks, Ende-zu-Ende-Verschlüsselung, Chat-Sperre und etwas sparsame, '
    + 'komplett private KI (Übersetzung, Transkription, Zusammenfassungen).',
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
