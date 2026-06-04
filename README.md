# Ping ⚡

Ein schneller, bunter Messenger. **Ping** besteht aus zwei Teilen:

- **`app/`** – die mobile App (Flutter, Material 3). Zielplattform ist Android,
  Windows-Desktop ist als zweite Plattform vorbereitet.
- **`server/`** – ein Realtime-Backend (Node.js, Express + WebSocket + SQLite),
  das ohne externe Dienste auskommt.

Beide Teile reden über eine REST-API (Login, Verlauf, Profile) und einen
WebSocket (neue Nachrichten, Tippen, Online-Status, Lesebestätigungen).

---

## Features

- **Konten** – Registrierung & Login mit Benutzername und Passwort, Sitzung
  bleibt erhalten (JWT, lokal gespeichert).
- **Direktchats & Gruppen** – jemanden über den Benutzernamen finden und
  losschreiben, oder eine Gruppe mit mehreren Leuten gründen.
- **Echtzeit** – Nachrichten kommen sofort an, inklusive Tippanzeige
  („tippt …"), Online-/Zuletzt-online-Status und ✓✓-Lesebestätigungen.
- **Nachrichten verwalten** – antworten (mit Zitat), bearbeiten, löschen,
  kopieren. Optimistisches Senden mit Wiederholung bei Fehlern.
- **Komfort** – ungelesen-Zähler, Chats stummschalten, Gruppen verlassen,
  Hell-/Dunkel-/System-Design, Profil mit Avatarfarbe und „Über mich".
- **Benachrichtigungen** – lokale Hinweise bei neuen Nachrichten (Android).

---

## Schnellstart

### 1. Server starten

```bash
cd server
npm install
npm start          # läuft auf http://0.0.0.0:8080
```

Für die Entwicklung reicht das so – ohne `JWT_SECRET` wird in Nicht-Produktion
ein zufälliges Secret pro Start erzeugt. Für den Produktivbetrieb `.env.example`
nach `.env` kopieren und ein festes `JWT_SECRET` setzen.

Tests:

```bash
cd server
npm test           # 8 End-to-End-Tests (Auth, Messaging, Rechte)
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

Beim ersten Start unter **Server-Adresse** (Login-Screen oder Einstellungen)
die Adresse des Servers eintragen:

| Wo läuft die App?            | Adresse                         |
|------------------------------|---------------------------------|
| Android-Emulator             | `http://192.0.2.1:8080`          |
| Echtes Gerät im selben WLAN  | `http://<PC-IP>:8080`           |
| Windows-Desktop              | `http://localhost:8080`         |

> Standardmäßig wird Klartext-HTTP erlaubt, damit ein selbst gehosteter Server
> im lokalen Netz sofort funktioniert. Für einen öffentlichen Server unbedingt
> HTTPS/WSS davorschalten und `usesCleartextTraffic` entfernen.

---

## Tests & Qualität

```bash
# Backend
cd server && npm test

# App
cd app && flutter analyze && flutter test
```

- Backend: 8 Tests decken Registrierung, Login (inkl. Timing-sicherer
  Fehlermeldung), Direktnachrichten mit Lesebestätigung über echte WebSockets,
  Gruppen, Bearbeiten/Löschen und Zugriffsschutz ab.
- App: Analyzer ist sauber; 12 Widget-/Unit-Tests für Modelle und UI.

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
│       ├── repo.js       # Nutzer & Kontakte
│       ├── auth.js       # JWT + bcrypt
│       └── validation.js # Eingabeprüfung (zod)
└── app/
    └── lib/
        ├── main.dart
        ├── theme.dart
        ├── models/       # PingUser, Chat, Message
        ├── services/     # ApiClient, SocketService, AppState, Notifications
        ├── screens/      # Login, Home, Chat, Gruppen, Einstellungen …
        └── widgets/      # Avatar, MessageBubble, ChatTile, Ticks
```

Der **`AppState`** (Provider/ChangeNotifier) ist die zentrale Quelle der
Wahrheit: er hält Chats, Nachrichten, Präsenz und Tippzustände, spricht mit
REST und Socket und benachrichtigt die Oberfläche.

---

## Sicherheit

- Passwörter mit bcrypt gehasht, nie im Klartext gespeichert oder geloggt.
- JWT-Authentifizierung für REST und WebSocket.
- Login mit konstanter Antwortzeit (kein Aufzählen gültiger Benutzernamen).
- Rate-Limiting (strenger auf Auth-Endpunkten), `helmet`, CORS-Konfiguration.
- Eingabevalidierung mit zod; alle SQL-Zugriffe sind parametrisiert.
- Zugriffsschutz: Nur Mitglieder eines Chats sehen dessen Nachrichten; nur der
  Autor kann seine Nachrichten bearbeiten oder löschen.
