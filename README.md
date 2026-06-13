# Ping ⚡

Ein schneller, bunter Messenger – mit **Registrierung über Handynummer, E-Mail
und Passwort** und **Chats über das eigene Adressbuch**. **Ping** besteht aus
zwei Teilen:

- **`app/`** – die mobile App (Flutter, Material 3). Zielplattform ist Android,
  Windows-Desktop ist als zweite Plattform vorbereitet.
- **`server/`** – ein Realtime-Backend (Node.js, Express + WebSocket + SQLite),
  das ohne externe Dienste auskommt.

Beide Teile reden über eine REST-API (Konto, Verlauf, Profile, Profilbilder,
Kontaktabgleich, Admin) und einen WebSocket (neue Nachrichten, Tippen,
Online-Status, Lesebestätigungen).

---

## Features

- **WhatsApp-artiges Design in Blau** – Material 3, Chat-Tabs (Chats & Status),
  Sprechblasen mit Haken, wählbarer Chat-Hintergrund und Hell-/Dunkelmodus.
- **Registrierung in einem Schritt** – Handynummer, E-Mail und Passwort eingeben,
  fertig. **Keine Bestätigung per SMS oder E-Mail.**
- **Anmeldung** – mit Handynummer **oder** E-Mail plus Passwort.
- **Kontakte nur per Telefonnummer** – Ping gleicht das Adressbuch ab und zeigt,
  wer davon schon bei Ping ist. Man findet andere **ausschließlich über die
  Telefonnummer** – nie über E-Mail oder eine Namenssuche.
- **Anhänge** – Fotos & Kamera, GIFs, beliebige Dateien und **Sprachnachrichten**
  (aufnehmen & abspielen) versenden, mit Vollbild-Bildbetrachter.
- **Vorlesen (Text-to-Speech)** – Nachrichten vorlesen lassen, optional
  automatisch im offenen Chat; Sprache, Tempo und Tonhöhe einstellbar.
- **Status** – wie bei WhatsApp: Text-, Bild- **oder Video**-Updates, die nach
  24 h ablaufen, mit „gesehen"-Ringen und Betrachterliste.
- **Verifizierungs-Badges** – ein unverkennbares **offizielles Siegel** für das
  „Ping-Team"-Konto, ein **blauer Haken** für Ping-Mitarbeiter/Admins und ein
  goldenes **Ping-Premium**-Abzeichen. Die Badges erscheinen überall neben dem
  Namen (Chatliste, Chat-Kopf, Status, Profil), damit offizielle Mitteilungen
  klar erkennbar sind. Premium vergeben Admins pro Konto.
- **Offizielle Mitteilungen** – Admins posten **offizielle Status** (Text/Bild/
  Video) für alle, senden Durchsagen, private „Ping-Team"-Nachrichten an einzelne
  oder an alle Nutzer; der „Ping-Team"-Kanal ist schreibgeschützt und gebrandet.
- **Umfragen** – Frage + bis zu 12 Antworten in jeden Chat senden; Abstimmen
  per Tipp, Live-Ergebnisbalken, optional mit Mehrfachauswahl.
- **Selbstlöschende Nachrichten** – per-Chat-Timer (1 h bis 90 Tage); neue
  Nachrichten verschwinden danach automatisch für alle.
- **Blockieren** – Kontakte blockieren; die Verbindung ist in beide Richtungen
  getrennt, bis die Blockierung aufgehoben wird.
- **Gruppen** – mehrere Kontakte auswählen, Gruppe benennen, Mitglieder hinzufügen.
- **Profile** – Profilbild (Galerie/Kamera), Anzeigename, Avatarfarbe und „Über mich".
- **Echtzeit** – sofortige Zustellung, Tippanzeige, Online-/Zuletzt-online-Status
  und ✓✓-Lesebestätigungen (abschaltbar).
- **Nachrichten verwalten** – antworten (mit Zitat), bearbeiten, „für alle" oder
  nur „für mich" löschen, kopieren, vorlesen. Optimistisches Senden mit
  Wiederholung bei Fehlern.
- **Entwürfe & Komfort** – unfertige Nachrichten bleiben pro Chat erhalten
  („Entwurf: …" in der Liste), „X neue Nachrichten"-Markierung beim Öffnen,
  Chats per Wischgeste anheften oder archivieren.
- **Viele Einstellungen** – Lesebestätigungen, Benachrichtigungen (Vorschau,
  Vibration), „mit Enter senden", Schriftgröße, Chat-Hintergrund, Vorlesen u. v. m.
- **Admin** – Web-Portal **und** In-App-Panel (für Admin-Konten): Statistik,
  Nutzerverwaltung, Premium vergeben, Durchsagen und offizielle Status (auch mit
  Bild/Video) an alle.
- **Benachrichtigungen** – lokale Hinweise bei neuen Nachrichten (Android).
- **Konto löschen** – jede Person kann ihr eigenes Konto dauerhaft löschen
  (mit Passwortbestätigung). Die Gespräche der anderen bleiben erhalten, die
  eigenen Nachrichten erscheinen dort nur noch als „Gelöschtes Konto".

---

## Datenschutz

Datenschutz ist eingebaut, nicht nachgerüstet:

- **Keine Fremd-Daten preisgegeben.** Telefonnummer und E-Mail einer Person
  werden **niemals** an andere Nutzer ausgeliefert – öffentliche Profile
  enthalten nur Name, Farbe, Bild und „Über mich".
- **Kein Adressbuch auf dem Server.** Beim Kontaktabgleich werden die
  Telefonnummern nur für die Dauer der Anfrage im Arbeitsspeicher verglichen und
  sofort verworfen – es wird **nichts gespeichert** und keine „wer-kennt-wen"-Liste
  aufgebaut.
- **Keine Namenssuche, keine E-Mail-Suche.** Es gibt bewusst keine
  Volltext-/Nutzersuche; man findet andere **nur über die exakte Telefonnummer**
  oder über die eigenen Kontakte. Die E-Mail dient ausschließlich dem Login. So
  kann niemand das Verzeichnis nach Fremden durchforsten.
- **Admin-Zugriff ist getrennt.** Personenbezogene Daten (Nummer, E-Mail) sind
  nur über das tokengeschützte Admin-Portal sichtbar, nie über die normale API.

---

## Schnellstart

### 1. Server starten

```bash
cd server
npm install
npm start          # läuft auf http://0.0.0.0:61337
```

Der Port **61337** liegt im privaten Port-Bereich und oberhalb des üblichen
Linux-Ephemeral-Bereichs – er kollidiert also nicht mit anderen Diensten auf
einem schon genutzten Server.

Für die Entwicklung reicht das so – ohne `JWT_SECRET` wird in Nicht-Produktion
ein zufälliges Secret pro Start erzeugt, und das Admin-Token ist `ping-admin-dev`.
Für den Produktivbetrieb `.env.example` nach `.env` kopieren und feste Werte für
`JWT_SECRET` **und** `ADMIN_TOKEN` setzen. `npm start` lädt `.env` automatisch
(`node --env-file-if-exists=.env`).

#### Dauerbetrieb mit systemd

Für einen Server, der beim Booten startet und nach einem Absturz automatisch
neu hochfährt, eignet sich ein systemd-Dienst. Eine fertige Unit liegt unter
`/etc/systemd/system/ping-server.service` (Arbeitsverzeichnis `server/`, lädt
`server/.env`):

```bash
sudo systemctl enable --now ping-server   # starten + beim Boot aktivieren
systemctl status ping-server              # Status ansehen
journalctl -u ping-server -f              # Live-Logs verfolgen
sudo systemctl restart ping-server        # nach einem Update neu starten
```

Tests:

```bash
cd server
npm test           # 67 End-to-End-Tests (Konto, Kontakte, Medien, Status, Badges, Premium, Admin, Newsroom/Changelog …)
```

### 2. App starten

```bash
cd app
flutter pub get
flutter run            # auf Emulator oder angeschlossenem Gerät
```

Oder ein installierbares APK bauen:

```bash
flutter build apk --release
# Ergebnis: build/app/outputs/flutter-apk/app-release.apk
```

### 3. App mit dem Server verbinden

Die App ist standardmäßig auf den Ping-Standardserver eingestellt — dessen
Adresse ist fest in der App hinterlegt und wird in der Oberfläche **nicht**
angezeigt (in den Einstellungen erscheint nur „Ping Cloud"). Die Adresse lässt
sich jederzeit auf dem Login-Screen oder in den Einstellungen unter
**Server-Adresse** überschreiben:

| Wo läuft die App?            | Server-Adresse              |
|------------------------------|-----------------------------|
| Eigener Server               | `https://<dein-server>`     |
| Eigener Server im WLAN       | `http://<Server-IP>:61337`  |
| Android-Emulator → lokaler PC| `http://192.0.2.1:61337`     |

> Den eingebauten Standardserver lässt sich beim Build überschreiben:
> `flutter build apk --dart-define=PING_SERVER=https://dein-server`.

> Standardmäßig wird Klartext-HTTP erlaubt, damit ein selbst gehosteter Server
> sofort funktioniert. Für einen öffentlichen Server unbedingt HTTPS/WSS
> davorschalten und `usesCleartextTraffic` entfernen.

---

## Konto & Chats – wie es funktioniert

1. **Registrieren.** Name, Handynummer, E-Mail und Passwort eingeben. Nummern
   ohne Ländervorwahl werden als deutsche Nummer (`+49`) behandelt; mit
   `+<Ländercode>` lässt sich das überschreiben (`DEFAULT_COUNTRY_CODE`). Es gibt
   **keinen** Bestätigungsschritt – das Konto ist sofort aktiv.
2. **Anmelden.** Später genügt Handynummer **oder** E-Mail plus Passwort.
3. **Kontakte freigeben.** Beim ersten „Neuer Chat → Aus Kontakten wählen" fragt
   die App nach Zugriff auf die Kontakte (`READ_CONTACTS`). Sie zeigt dann nur die
   Kontakte, die schon ein Ping-Konto haben.
4. **Direkt per Telefonnummer.** Alternativ unter „Neuer Chat → Per Telefonnummer"
   jemanden direkt anschreiben, sofern die Person registriert ist.

---

## Admin-Portal

Unter **`/admin`** (z. B. `https://<dein-server>/admin`) gibt es eine schlanke
Web-Oberfläche zum Verwalten der Nutzer:

- Statistik (Nutzer, online, Chats, Gruppen, Nachrichten, aktive Status,
  Newsroom- & Changelog-Beiträge),
- Durchsage an alle verbundenen Apps senden,
- offizielle **Status für alle** posten – als Text **oder mit Bild/Video** (Upload
  direkt im Portal),
- private „Ping-Team"-Nachrichten an einzelne Nutzer oder an alle,
- **Inhalte** verwalten: **Newsroom-Artikel** (Kategorie, Titelbild, Markdown-
  leichter Text) und **Changelog-Einträge** (Version, Art der Änderung) anlegen,
  bearbeiten, anpinnen, als Entwurf speichern oder veröffentlichen,
- Nutzer anlegen (Nummer, E-Mail, Passwort, optional Admin-Flag),
- **Ping Premium** vergeben/entziehen (Premium-Badge),
- Liste durchsuchen, Namen/Passwörter ändern, Admin-Rechte setzen, sperren,
  Nutzer löschen. Das geschützte „Ping-Team"-Systemkonto lässt sich nicht
  bearbeiten oder löschen.

Der Zugang geht über das **`ADMIN_TOKEN`** (Header `X-Admin-Token`, timing-sicher
verglichen) **oder** über ein angemeldetes Admin-Konto — Letzteres treibt auch
das **In-App-Admin-Panel** (Einstellungen → Verwaltung) an. In Produktion ohne
gesetztes Token und ohne Admin-Konto bleibt das Portal deaktiviert (`503`). In
der Entwicklung lautet das Token `ping-admin-dev`.

---

## Website

Die öffentliche Marketing-Seite läuft unter der Hauptadresse
**`example.invalid`** (die alte Adresse `example.invalid` bleibt als
Alias erhalten und zeigt auf dasselbe Backend). Alle Seiten teilen sich ein
Design-System (`server/public/site.css` + `site.js`):

- **`/`** – Startseite mit Live-Statistik, Funktionsüberblick, Newsroom- &
  Changelog-Teasern und direktem APK-Download.
- **`/news`** (+ `/news/:slug`) – **Newsroom** mit Artikeln, Kategorien und
  Titelbildern; Einzelartikel mit eigenem Layout.
- **`/changelog`** – **Changelog** als Timeline, filterbar nach Art der Änderung
  (Neu/Verbessert/Behoben/Sicherheit).
- **`/status`** – öffentliche **System-Status-Seite**: zeigt live, ob API,
  Echtzeit-Verbindung und Daten-Dienste laufen, inkl. Live-Zählern und Uptime.
- **`/legal`** – Impressum & Datenschutzerklärung.

Newsroom und Changelog speisen sich aus der öffentlichen JSON-API
(`/api/news`, `/api/news/:slug`, `/api/changelog`, `/api/public/stats`) und werden
im Admin-Portal unter **Inhalte** gepflegt. Eine Startbefüllung gibt es per
`node scripts/seed-content.mjs` (liest `ADMIN_TOKEN` aus `server/.env`).

---

## Tests & Qualität

```bash
# Backend
cd server && npm test

# App
cd app && flutter analyze && flutter test
```

- **Backend:** 67 Tests decken Registrierung (Nummer + E-Mail + Passwort,
  Pflichtfelder, Dubletten), Anmeldung per Nummer/E-Mail, den privatsphäre-
  schonenden **Telefon-Kontaktabgleich** (E-Mail-Discovery ist abgeschaltet),
  Direktnachrichten per Nummer/ID mit Lesebestätigung über echte WebSockets,
  Gruppen, Bearbeiten/Löschen, Zugriffsschutz, **Medien-Uploads & -Nachrichten**,
  **Status** (posten/sehen/Betrachter), **Blockieren**, Profilbild-Upload sowie
  das Admin-Portal (Token **oder** Admin-Konto) inkl. Durchsagen sowie die
  **Newsroom-/Changelog-Verwaltung** (Entwürfe bleiben privat, öffentliche
  Listen zeigen nur Veröffentlichtes) und die öffentlichen **Live-Statistiken**.
  Geprüft wird außerdem, dass öffentliche Antworten nie Nummer oder E-Mail leaken.
- **App:** Modelle und UI-Widgets sind durch Unit-/Widget-Tests abgedeckt.

---

## Architektur

```
ping/
├── server/
│   ├── public/
│   │   ├── index.html    # Landing-Page (Live-Stats, Newsroom/Changelog-Teaser)
│   │   ├── news.html     # Newsroom (Liste + Einzelartikel)
│   │   ├── changelog.html# Changelog-Timeline
│   │   ├── status.html   # Öffentliche System-Status-Seite
│   │   ├── legal.html    # Impressum & Datenschutz
│   │   ├── site.css/.js  # Gemeinsames Web-Design-System (Nav, Footer, Helfer)
│   │   └── admin.html    # Admin-Portal (statische Seite, tokengeschützt)
│   ├── scripts/
│   │   ├── publish-apk.sh   # Release-APK in den Download-Ordner kopieren
│   │   └── seed-content.mjs # Newsroom/Changelog mit Startinhalten füllen
│   └── src/
│       ├── index.js      # HTTP + WS Server, Security-Middleware, /admin
│       ├── routes.js     # REST-Endpunkte (inkl. Kontaktabgleich, Admin, Content)
│       ├── download.js   # Landing-/Web-Seiten + APK-Auslieferung
│       ├── hub.js        # WebSocket-Hub: Präsenz, Tippen, Zustellung
│       ├── chatRepo.js   # Chats & Nachrichten (SQLite)
│       ├── repo.js       # Nutzer, Avatare, Kontaktabgleich, Serialisierung
│       ├── postsRepo.js  # Newsroom-Artikel & Changelog-Einträge (SQLite)
│       ├── auth.js       # JWT + bcrypt + Admin-Token-Middleware
│       ├── phone.js      # Telefonnummer-Normalisierung (E.164)
│       ├── avatars.js    # Profilbilder auf der Platte
│       └── validation.js # Eingabeprüfung (zod)
└── app/
    └── lib/
        ├── main.dart
        ├── theme.dart
        ├── models/       # PingUser, ContactMatch, Chat, Message
        ├── services/     # ApiClient, SocketService, AppState, Contacts, Notifications
        ├── screens/      # Login/Registrierung, Home, Chat, Kontaktauswahl …
        └── widgets/      # Avatar (mit Foto), MessageBubble, ChatTile, Ticks
```

Der **`AppState`** (Provider/ChangeNotifier) ist die zentrale Quelle der
Wahrheit: er hält Chats, Nachrichten, Präsenz und Tippzustände, spricht mit
REST und Socket und benachrichtigt die Oberfläche.

---

## Sicherheit

- Konto = Handynummer + E-Mail + Passwort. Passwörter werden mit bcrypt gehasht,
  nie im Klartext gespeichert.
- JWT-Authentifizierung für REST und WebSocket; Profilbilder sind ebenfalls
  zugriffsgeschützt.
- Anmeldung mit konstanter Antwortzeit (kein Aufzählen gültiger Konten).
- Rate-Limiting (strenger auf Auth- und Admin-Endpunkten), `helmet`,
  CORS-Konfiguration.
- Eingabevalidierung mit zod; alle SQL-Zugriffe sind parametrisiert.
- Zugriffsschutz: Nur Mitglieder eines Chats sehen dessen Nachrichten; nur der
  Autor kann seine Nachrichten bearbeiten oder löschen.
- Datenschutz: Nummer/E-Mail werden nie an andere Nutzer ausgeliefert, das
  Adressbuch wird nur flüchtig abgeglichen und nie gespeichert, und Personendaten
  sind ausschließlich über das tokengeschützte Admin-Portal einsehbar.
- Das Admin-Token wird timing-sicher verglichen; ohne gesetztes Token ist das
  Portal in Produktion deaktiviert.
