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

- **Registrierung in einem Schritt** – Handynummer, E-Mail und Passwort eingeben,
  fertig. **Keine Bestätigung per SMS oder E-Mail.** Für ein Konto braucht man
  immer alle drei: Nummer, E-Mail und Passwort.
- **Anmeldung** – mit Handynummer **oder** E-Mail plus Passwort.
- **Chats über Kontakte** – Ping gleicht das Adressbuch ab und zeigt, wer davon
  schon bei Ping ist. Mit einem Tipp ist der Chat gestartet. Alternativ direkt
  eine Handynummer oder E-Mail eingeben.
- **Gruppen** – mehrere Kontakte auswählen, Gruppe benennen, später weitere
  Mitglieder hinzufügen.
- **Profile** – Profilbild (aus Galerie oder Kamera), Anzeigename, Avatarfarbe und
  „Über mich". Bilder erscheinen überall: Chatliste, Chat, Gruppen, Infos.
- **Echtzeit** – Nachrichten kommen sofort an, inklusive Tippanzeige („tippt …"),
  Online-/Zuletzt-online-Status und ✓✓-Lesebestätigungen.
- **Nachrichten verwalten** – antworten (mit Zitat), bearbeiten, löschen,
  kopieren. Optimistisches Senden mit Wiederholung bei Fehlern.
- **Admin-Portal** – einfache Web-Oberfläche zum Verwalten und Anlegen von
  Nutzern (`/admin`), abgesichert über ein geheimes Token.
- **Komfort** – Ungelesen-Zähler, Chats stummschalten, Gruppen verlassen,
  Hell-/Dunkel-/System-Design.
- **Benachrichtigungen** – lokale Hinweise bei neuen Nachrichten (Android).

---

## Datenschutz

Datenschutz ist eingebaut, nicht nachgerüstet:

- **Keine Fremd-Daten preisgegeben.** Telefonnummer und E-Mail einer Person
  werden **niemals** an andere Nutzer ausgeliefert – öffentliche Profile
  enthalten nur Name, Farbe, Bild und „Über mich".
- **Kein Adressbuch auf dem Server.** Beim Kontaktabgleich werden die Nummern/
  E-Mails nur für die Dauer der Anfrage im Arbeitsspeicher verglichen und sofort
  verworfen – es wird **nichts gespeichert** und keine „wer-kennt-wen"-Liste
  aufgebaut.
- **Keine Namenssuche.** Es gibt bewusst keine Volltext-/Nutzersuche; man findet
  andere nur über die exakte Nummer/E-Mail oder über die eigenen Kontakte. So
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
`JWT_SECRET` **und** `ADMIN_TOKEN` setzen.

Tests:

```bash
cd server
npm test           # 16 End-to-End-Tests (Konto, Kontakte, Avatare, Messaging, Admin …)
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

Die App ist standardmäßig auf den öffentlichen Ping-Server eingestellt:

| Wo läuft die App?            | Server-Adresse                  |
|------------------------------|---------------------------------|
| Standard (vorausgefüllt)     | `http://192.0.2.1:61337`    |
| Eigener Server im WLAN       | `http://<Server-IP>:61337`      |
| Android-Emulator → lokaler PC| `http://192.0.2.1:61337`         |

Die Adresse lässt sich jederzeit auf dem Login-Screen oder in den Einstellungen
unter **Server-Adresse** ändern.

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
4. **Direkt per Nummer/E-Mail.** Alternativ unter „Neuer Chat → Per Nummer oder
   E-Mail" jemanden direkt anschreiben, sofern die Person registriert ist.

---

## Admin-Portal

Unter **`/admin`** (z. B. `http://192.0.2.1:61337/admin`) gibt es eine
schlanke Web-Oberfläche zum Verwalten der Nutzer:

- Nutzer anlegen (Nummer, E-Mail, Passwort, optional Admin-Flag),
- Liste durchsuchen, Namen/Passwörter ändern, Admin-Rechte setzen, Nutzer löschen.

Der Zugang ist über das **`ADMIN_TOKEN`** geschützt (Header `X-Admin-Token`,
timing-sicher verglichen). In Produktion ohne gesetztes Token bleibt das Portal
deaktiviert (`503`). In der Entwicklung lautet das Token `ping-admin-dev`.

---

## Tests & Qualität

```bash
# Backend
cd server && npm test

# App
cd app && flutter analyze && flutter test
```

- **Backend:** 16 Tests decken Registrierung (Nummer + E-Mail + Passwort,
  Pflichtfelder, Dubletten), Anmeldung per Nummer/E-Mail, den privatsphäre-
  schonenden Kontaktabgleich, Direktnachrichten per Nummer/E-Mail/ID mit
  Lesebestätigung über echte WebSockets, Gruppen, Bearbeiten/Löschen,
  Zugriffsschutz, Profilbild-Upload sowie das tokengeschützte Admin-Portal ab.
  Geprüft wird außerdem, dass öffentliche Antworten nie Nummer oder E-Mail leaken.
- **App:** Modelle und UI-Widgets sind durch Unit-/Widget-Tests abgedeckt.

---

## Architektur

```
ping/
├── server/
│   ├── public/
│   │   └── admin.html    # Admin-Portal (statische Seite, tokengeschützt)
│   └── src/
│       ├── index.js      # HTTP + WS Server, Security-Middleware, /admin
│       ├── routes.js     # REST-Endpunkte (inkl. Kontaktabgleich, Admin)
│       ├── hub.js        # WebSocket-Hub: Präsenz, Tippen, Zustellung
│       ├── chatRepo.js   # Chats & Nachrichten (SQLite)
│       ├── repo.js       # Nutzer, Avatare, Kontaktabgleich, Serialisierung
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
