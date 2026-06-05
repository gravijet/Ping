# Ping ⚡

Ein schneller, bunter Messenger – mit **Anmeldung über die Handynummer**, so wie
man es von modernen Messengern kennt. **Ping** besteht aus zwei Teilen:

- **`app/`** – die mobile App (Flutter, Material 3). Zielplattform ist Android,
  Windows-Desktop ist als zweite Plattform vorbereitet.
- **`server/`** – ein Realtime-Backend (Node.js, Express + WebSocket + SQLite),
  das ohne externe Dienste auskommt.

Beide Teile reden über eine REST-API (Login, Verlauf, Profile, Profilbilder) und
einen WebSocket (neue Nachrichten, Tippen, Online-Status, Lesebestätigungen).

---

## Features

- **Anmeldung per Handynummer** – kein Benutzername, kein Passwort nötig. Nummer
  eingeben, Bestätigungscode erhalten, fertig. Neue Konten richten einmalig ihr
  Profil ein (Name, Bild, Farbe, „Über mich").
- **Backup mit E-Mail & Passwort** – optional in den Einstellungen hinterlegbar,
  um sich auch ohne SMS-Code anmelden zu können.
- **Schreiben an Telefonnummern** – einfach eine Nummer eingeben und losschreiben,
  oder Leute über Name/Nummer suchen. Dazu Gruppen mit mehreren Personen.
- **Profile** – Profilbild (aus Galerie oder Kamera), Anzeigename, Avatarfarbe und
  „Über mich". Bilder erscheinen überall: Chatliste, Chat, Gruppen, Infos.
- **Echtzeit** – Nachrichten kommen sofort an, inklusive Tippanzeige („tippt …"),
  Online-/Zuletzt-online-Status und ✓✓-Lesebestätigungen.
- **Nachrichten verwalten** – antworten (mit Zitat), bearbeiten, löschen,
  kopieren. Optimistisches Senden mit Wiederholung bei Fehlern.
- **Komfort** – Ungelesen-Zähler, Chats stummschalten, Gruppen verlassen,
  Hell-/Dunkel-/System-Design.
- **Benachrichtigungen** – lokale Hinweise bei neuen Nachrichten (Android).

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
ein zufälliges Secret pro Start erzeugt. Für den Produktivbetrieb `.env.example`
nach `.env` kopieren und ein festes `JWT_SECRET` setzen.

> **SMS-Versand:** Ping bringt keinen SMS-Anbieter mit. Standardmäßig wird der
> Bestätigungscode deshalb direkt in der API-Antwort zurückgegeben (und ins
> Server-Log geschrieben) – so funktioniert die Anmeldung sofort, und die App
> trägt den Code automatisch ein. Für den echten Betrieb einen SMS-Dienst
> davorschalten und `OTP_RETURN_IN_RESPONSE=false` setzen
> (siehe `server/src/otp.js`, `deliver()`).

Tests:

```bash
cd server
npm test           # 14 End-to-End-Tests (Auth, Avatare, Messaging, Rechte …)
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

## Anmeldung – wie es funktioniert

1. **Nummer eingeben.** Nummern ohne Ländervorwahl werden als deutsche Nummer
   (`+49`) behandelt; mit `+<Ländercode>` lässt sich das überschreiben
   (konfigurierbar über `DEFAULT_COUNTRY_CODE`).
2. **Code bestätigen.** Der Server schickt einen 6-stelligen Code. Im Demo-Modus
   (ohne SMS-Anbieter) ist er schon eingetragen.
3. **Profil einrichten.** Beim ersten Mal: Name, Profilbild, Farbe, „Über mich".
4. **Backup hinterlegen (optional).** In *Einstellungen → Profil → Sicherung &
   Login* eine E-Mail und ein Passwort setzen, um sich später auch per
   Passwort anmelden zu können.

---

## Tests & Qualität

```bash
# Backend
cd server && npm test

# App
cd app && flutter analyze && flutter test
```

- **Backend:** 14 Tests decken Telefon-Login (Code anfordern/prüfen, Normalisierung),
  Konto-Anlage, Direktnachrichten per Telefonnummer mit Lesebestätigung über echte
  WebSockets, Gruppen, Bearbeiten/Löschen, Zugriffsschutz, Profilbild-Upload und
  das E-Mail/Passwort-Backup ab.
- **App:** Modelle und UI-Widgets sind durch Unit-/Widget-Tests abgedeckt.

---

## Architektur

```
ping/
├── server/
│   └── src/
│       ├── index.js      # HTTP + WS Server, Security-Middleware
│       ├── routes.js     # REST-Endpunkte
│       ├── hub.js        # WebSocket-Hub: Präsenz, Tippen, Zustellung
│       ├── chatRepo.js   # Chats & Nachrichten (SQLite)
│       ├── repo.js       # Nutzer (Telefon), Avatare, Kontakte
│       ├── auth.js       # JWT + bcrypt (Backup-Passwort)
│       ├── otp.js        # Einmal-Login-Codes
│       ├── phone.js      # Telefonnummer-Normalisierung (E.164)
│       ├── avatars.js    # Profilbilder auf der Platte
│       └── validation.js # Eingabeprüfung (zod)
└── app/
    └── lib/
        ├── main.dart
        ├── theme.dart
        ├── models/       # PingUser (Telefon), Chat, Message
        ├── services/     # ApiClient, SocketService, AppState, Notifications
        ├── screens/      # Telefon-Login, Code, Profil-Setup, Home, Chat …
        └── widgets/      # Avatar (mit Foto), MessageBubble, ChatTile, Ticks
```

Der **`AppState`** (Provider/ChangeNotifier) ist die zentrale Quelle der
Wahrheit: er hält Chats, Nachrichten, Präsenz und Tippzustände, spricht mit
REST und Socket und benachrichtigt die Oberfläche.

---

## Sicherheit

- Identität ist die Telefonnummer; Anmeldung über zeitlich begrenzte Einmal-Codes
  (gehasht und an Nummer + Server-Secret gebunden, mit Versuchslimit).
- Optionales Backup-Passwort mit bcrypt gehasht, nie im Klartext gespeichert.
- JWT-Authentifizierung für REST und WebSocket; Profilbilder sind ebenfalls
  zugriffsgeschützt.
- Passwort-Login mit konstanter Antwortzeit (kein Aufzählen gültiger Konten).
- Rate-Limiting (strenger auf Auth-Endpunkten), `helmet`, CORS-Konfiguration.
- Eingabevalidierung mit zod; alle SQL-Zugriffe sind parametrisiert.
- Zugriffsschutz: Nur Mitglieder eines Chats sehen dessen Nachrichten; nur der
  Autor kann seine Nachrichten bearbeiten oder löschen; E-Mail wird nie an
  andere Nutzer ausgeliefert.
