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

- **„Alles" – das Mega-Update** (seit 0.34.0) – **25 neue Funktionen** auf einmal,
  jede einzeln zuschaltbar, quer durch alle Bereiche: **Threads** (Antwortketten),
  **Gruppenanrufe**, **geplante Anrufe**, **Live-Standort** und **on-prem
  Sprach­transkription**; **Sticker**, **GIF-Suche**, **Einmal-ansehen**-Medien und
  **Chat-Optik** pro Chat; **Kanban-Boards**, **Mini-Spiele**, **Gruppen-Notizen**,
  **wiederkehrende Termine**, eine **Medien-/Datei-/Link-Galerie** und **Webhooks/
  Bots**; **opt-in Ende-zu-Ende-Verschlüsselung (Beta)** für DMs, **Chat-Sperre**,
  **Anmelde-Freigabe** vom Zweitgerät, ein **Standard-Selbstzerstörungs-Timer** und
  ein **Screenshot-Hinweis**; dazu **sparsame, komplett private KI** – Übersetzung
  (selbst-gehostetes LibreTranslate), Sprach­transkription (whisper.cpp), die
  **„Hol mich ab"**-Zusammenfassung (rein lokal) und heuristische **Smart Replies**.
  Kein Cloud-LLM, keine Datenabflüsse. Volle Oberfläche im **Web & Windows**, alle
  Server-Funktionen für **Android** per OTA.
- **Kontaktkarten & Code-Snippets** (seit 0.35.0) – teile eine Person als
  schicke **Kontaktkarte** (Foto, Name, `@Handle`) mit direktem **„Chat starten"**,
  und teile Code als **Snippet-Karte** mit **Syntax-Hervorhebung**, **Kopieren**
  per Tipp und Vollbild-Ansicht. Beides nativ auf Web, Windows und Android und
  sofort durchsuchbar (`typ:kontakt`, `typ:code`). Schaltbar über `contactCards`
  und `codeSnippets`.
- **Termine & Aufgaben** (seit 0.33.0) – plane **Termine** direkt im Chat (Titel,
  Datum, Ort, Beschreibung) und lass alle mit **Zusage / Vielleicht / Absage**
  antworten – mit Live-Zählung, Teilnehmerliste und einer chat­übergreifenden
  **„Termine"-Übersicht**. Eine optionale Erinnerung wird **automatisch
  serverseitig** vor dem Start verschickt. Teile außerdem **Aufgabenlisten
  (Checklisten)**: jede:r hakt Punkte ab oder fügt welche hinzu, der
  **Fortschrittsbalken** aktualisiert sich in Echtzeit. Schaltbar über `events`
  und `taskLists`.
- **Benutzernamen & Zwei-Faktor** (seit 0.32.0) – sichere dir einen eindeutigen
  **`@Benutzernamen`** und lass dich darüber finden und anschreiben (mit
  Personensuche und `?u=@name`-Profil-Links) – ganz ohne deine Telefonnummer.
  Schütze dein Konto optional mit **Zwei-Faktor-Authentifizierung (TOTP)** inkl.
  QR-Einrichtung und **Wiederherstellungscodes**. Neue **Privatsphäre-Regeln**
  legen fest, **wer dir schreiben** und **wer dich zu Gruppen hinzufügen** darf;
  ein **Sicherheits-Center** zeigt ein Anmelde-/Sicherheitsprotokoll und meldet
  dich auf Wunsch **überall ab**. Schaltbar über `usernames`, `twoFactor`,
  `privacyControls`.
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
  24 h ablaufen, mit „gesehen"-Ringen und Betrachterliste. Beim Ansehen wird
  automatisch beim ersten **noch ungesehenen** Update gestartet (alte werden nicht
  erneut gezeigt), und die Ringfarben zeigen klar, was neu und was schon gesehen ist.
- **Anrufe** – 1:1-**Sprach- und Videoanrufe** über WebRTC, mit echtem
  Klingelton/Freizeichen, Vibration, Anrufdauer, Voll­bild-Eingangsanruf (auch
  über den Sperrbildschirm) und **Anrufverlauf** (Tab „Anrufe", inkl. Rückruf).
  STUN/TURN liefert der Server über `/api/ice`.
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
- **Kanäle & Entdecken** (seit 0.31.0) – öffentliche, **entdeckbare Broadcast-
  Kanäle**. Erstelle einen Kanal mit Name, eindeutigem **`@handle`**, Beschreibung
  und Kategorie; im neuen **Entdecken**-Bereich durchsuchst du das nach Abonnenten
  sortierte Verzeichnis, filterst nach Kategorie und folgst per Tipp. Im Kanal
  postet nur der/die Betreiber:in – alle anderen **lesen und reagieren**. Jeder
  Kanal hat einen teilbaren `/?c=<handle>`-Link. (Server-seitig ein öffentlicher
  Broadcast-Gruppenchat, daher mit voller History, Reaktionen, Suche und Push.)
  Per Feature-Flag `communities` abschaltbar.
- **Erweiterte Suche** (seit 0.30.0) – Volltextsuche über alle Chats mit
  **SQLite FTS5**: relevanz-sortiert (bm25), mit **hervorgehobenen Treffern** und
  Filtern direkt in der Suchzeile – `von:` (Absender), `typ:` (foto · video ·
  datei · sprache · umfrage), `nach:` / `vor:` (Datum). Eigene Such-Ansicht mit
  Skeletons und Sprung direkt zur Nachricht. (Fällt automatisch auf die einfache
  Suche zurück, falls FTS5 fehlt.)
- **Fokus & Ruhezeiten** (seit 0.30.0) – ein kontogebundener, geräteübergreifend
  synchroner Schalter, der den Server **Push zurückhalten** lässt, während du im
  **Fokus** bist (Schnellwahl 30 Min / 1 Std / 4 Std / *bis morgen*) oder in
  deinem **Ruhezeit-Fenster** (Start/Ende + Wochentage). Live-Nachrichten kommen
  weiterhin sofort – du wirst nur nicht angepingt. Optionale **Auto-Antwort** auf
  Direktnachrichten (höchstens alle 2 Std je Kontakt). Serverseitig erzwungen,
  gilt also für **alle** Clients inkl. Android.
- **Erinnerungen – „Erinnere mich"** (seit 0.29.0) – lass dich an jede Nachricht
  zu einem gewählten Zeitpunkt erinnern (Vorlagen wie *in 20 Min*, *heute Abend*,
  *morgen früh*, oder eigener Termin). Die Erinnerung wird mit einem Schnappschuss
  der Nachricht gespeichert, kommt **live über die Socket-Verbindung** und – bei
  geschlossener App – **per Push**. Eigene „Erinnerungen"-Ansicht inklusive Zähler.
- **Schnellantworten – jetzt geräteübergreifend** (seit 0.29.0) – vorbereitete
  Antworten liegen am Konto und synchronisieren auf alle Geräte; optional mit
  einem **`/kürzel`**, das du direkt im Eingabefeld ausschreibst (`/gn8 `).
- **Chat-Export – vollständig** (seit 0.29.0) – eine Unterhaltung als komplette
  Abschrift (nicht nur das Geladene) als **.txt** oder strukturiertes **.json**
  herunterladen, serverseitig gestreamt mit echten Absendernamen.
- **Link-Vorschauen** (seit 0.28.0) – geteilte Links werden zu einer kompakten
  Karte mit Titel, Beschreibung, Seitenname und Vorschaubild aufgelöst. Lädt erst
  beim Sichtbarwerden, wird pro URL **einmal serverseitig** geholt und
  zwischengespeichert, spart auf Wunsch im Datensparmodus das Bild – und zeigt für
  Links ohne Metadaten einfach nichts. SSRF-gehärtet (keine internen Adressen).
- **Bearbeitungsverlauf** (seit 0.28.0) – jede Bearbeitung sichert die vorige
  Fassung; ein Tipp auf „bearbeitet" zeigt, wie sich eine Nachricht verändert hat.
- **Angepinnte Nachrichten** (seit 0.27.0) – wichtige Nachrichten anpinnen; alle
  im Chat sehen sie in einem Banner unter dem Kopf, tippen zum Springen (und
  Durchblättern mehrerer Pins), bis zu 50 pro Chat, in Echtzeit für alle.
- **Chat-Ordner** (seit 0.27.0) – Unterhaltungen in eigene Ordner gruppieren und
  die Chatliste per Filter-Chip danach filtern; Ordner synchronisieren über alle
  Geräte.
- **Gespeicherte Nachrichten & Entwürfe – geräteübergreifend** (seit 0.27.0) –
  markierte Nachrichten und angefangene Texte werden serverseitig synchronisiert
  und tauchen auf deinen anderen Geräten und im Web wieder auf.
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
- **Benachrichtigungen** – Push **und** lokale Hinweise bei neuen Nachrichten,
  Durchsagen, **Status-Updates** und **Anrufen** (Android, via Firebase Cloud
  Messaging). Eingehende Anrufe kommen als hochpriorer Daten-Push und klingeln
  per Voll­bild-Hinweis, auch wenn die App geschlossen ist; verpasste Anrufe
  erzeugen eine eigene Notiz.
- **Benachrichtigungen überall (seit 0.25.0)** – im **Web** echte
  System-Benachrichtigungen, **auch wenn der Tab/Browser geschlossen ist** (Web
  Push, abhängigkeitsfrei nach RFC 8291/8292); auf **Android** **direkt antworten
  und „gelesen"** aus der Benachrichtigung heraus, **Launcher-Verknüpfungen** zu
  letzten Chats und eine **Schnelleinstellungen-Kachel** zum Stummschalten; auf
  **Windows** **Toast-Aktionen** und ein „Nicht stören"-Eintrag im Infobereich.
  Installierte Web-Apps zeigen einen **OS-Symbol-Badge** mit der Ungelesen-Zahl.
- **Diagnose, Statistik & Entwickleroptionen (seit 0.26.0)** – auf **Android**
  eine **Diagnose**-Seite mit auf dem Gerät gespeicherten Fehlerberichten
  (Telefonnummern und Tokens werden vor dem Speichern entfernt; nichts wird je
  übertragen), zum Einsehen, Kopieren oder Mailen; eine **opt-in** „Deine
  Statistik" mit rein lokalen Nutzungszahlen und einem abhängigkeitsfreien
  7-Tage-Diagramm; und **Entwickleroptionen** (sieben Tipps auf die
  Versionszeile) mit Feature-Flag-Inspektor und Performance-Overlay. Dazu
  **Skeleton-Ladeansichten** und ruhigere Seitenübergänge, die „Bewegung
  reduzieren" respektieren.
- **Konto löschen** – jede Person kann ihr eigenes Konto dauerhaft löschen
  (mit Passwortbestätigung). Die Gespräche der anderen bleiben erhalten, die
  eigenen Nachrichten erscheinen dort nur noch als „Gelöschtes Konto".

### Ping Web & Desktop (PWA, seit 0.20.0)

Der PC-Client (und damit auch die Windows-App, die ihn umhüllt) ist eine echte,
installierbare **Progressive Web App**:

- **Offline-fähig** – ein Service Worker cached die App-Hülle; Ping startet und
  läuft ohne Verbindung (API/WS/Medien werden nie gecacht – kein Datenleck). Seit
  0.22.0 hält ein **IndexedDB-Cache** zusätzlich die Chatliste und die letzten
  Nachrichten je Chat vor, sodass alte Gespräche auch offline lesbar bleiben.
- **Offline senden** – während du offline bist getippte Nachrichten landen in
  einer persistenten Warteschlange, erscheinen als „⧗ ausstehend" und werden
  automatisch zugestellt, sobald die Verbindung zurück ist (mit Wiederholung).
- **Ladezustände** – Skeleton-Screens für Chatliste und Verlauf, ein
  Verbindungs-Banner für „offline/wird wiederhergestellt".
- **Teilen** – Nachrichten, Chat-Links und Einladungen über das System-Teilen
  oder die Zwischenablage; `?chat=`-Deeplinks öffnen ein Gespräch direkt.
- **Diagnose (optional, anonym)** – standardmäßig **aus**; kein Tracking, keine
  Inhalte. Plus ein Entwickler-Panel (`Strg/⌘ + ⇧ + D`) mit Verbindung,
  Feature-Flags, API-Inspektor und Absturzprotokoll.

#### Neu in 0.22.0

- **Offline-First, echt** – ein **IndexedDB-Cache** hält Chatliste und die
  letzten ~80 Nachrichten je Chat vor: Ping öffnet sofort und bleibt ohne
  Verbindung lesbar; die Live-Daten gleichen sich danach ab. Der Cache ist pro
  Konto abgesichert und wird beim Abmelden gelöscht.
- **Sync-Queue für Lesebestätigungen** – „gelesen/zugestellt", die ein getrennter
  Socket nicht annehmen konnte, werden gepuffert und bei der nächsten Verbindung
  nachgereicht (entdoppelt pro Chat).
- **„Neue Nachrichten"-Trenner & Zähler** – kommen Nachrichten herein, während du
  oben liest, markiert ein Trenner die erste neue Nachricht und der
  Nach-unten-Knopf trägt einen Ungelesen-Zähler.
- **AMOLED-Schwarz** – ein echtes Schwarz für das dunkle Design (OLED-schonend),
  umschaltbar in Einstellungen → Design.
- **Profil-Links zum Teilen** – `?u=<id>` öffnet die Profilkarte einer Person und
  bietet direkt „Nachricht senden"; teilbar aus der Profilkarte.
- **Schneller** – ungenutzte Bereiche werden im Leerlauf vorgeladen, Bilder erst
  beim Sichtbarwerden (Lazy-Loading) geholt.
- **Mehr Entwickler-Werkzeuge** – das Debug-Panel zeigt Leistungswerte, einen
  Cache-Inspektor und einen „Offline simulieren"-Schalter.

#### Neu in 0.21.0

- **@-Erwähnungen** in Gruppen – `@` öffnet eine Mitglieder-Auswahl (Pfeiltasten,
  Enter/Tab); Erwähnungen werden hervorgehoben, dich betreffende extra. Erwähnte
  Chats tragen ein `@`-Abzeichen, bis du sie öffnest.
- **Aktivitäts-Center** – die Glocke in der Navigationsleiste sammelt Reaktionen
  auf deine Nachrichten, Erwähnungen, neue Chats und verpasste Anrufe (mit
  Ungelesen-Zähler).
- **Nachrichten-Entwürfe** – ungesendeter Text wird je Chat gemerkt und beim
  erneuten Öffnen wiederhergestellt; die Liste zeigt „Entwurf: …".
- **Theme Studio** – acht Vorlagen, eigene Akzentfarbe und ein teilbarer
  `ping-theme:`-Code zum Mitnehmen auf andere Geräte.
- **Nutzungs-Insights** – eine 7-Tage-Statistik deiner gesendeten Nachrichten,
  **nur lokal**, nie übertragen.
- **Tastenkürzel-Übersicht** – Taste `?` zeigt alle Shortcuts gruppiert an.
- **Update-Hinweis** – nach einem Deploy bietet ein Banner „Neu laden" an, statt
  Assets stillschweigend auszutauschen.
- **Hintergrund-Updates (Android)** – das In-App-Update lädt das neue APK über
  Androids System-Downloadmanager. Der Download **läuft weiter, wenn du Ping
  verlässt oder schließt**, zeigt eine System-Benachrichtigung mit Fortschritt
  und wird beim erneuten Öffnen fortgesetzt; abgebrochene Downloads setzen dank
  Range-Requests am Server dort fort, wo sie waren – statt neu zu starten.
- **Geräte & Diagnose (Android)** – ein eigener Bereich in den Einstellungen
  zeigt **live** Akku (mit Temperatur, Zustand, Spannung), Energie-/Temperatur-
  und Energiesparzustand, Netzwerk (Typ, getaktet, Bandbreite), Arbeits- und
  Gerätespeicher sowie System-Infos **bis hin zur Linux-Kernel-Version** – über
  eine native Brücke (`BatteryManager`, `PowerManager`, `ConnectivityManager`,
  `ActivityManager`, `StatFs`). Damit hält Ping bei wenig Akku, im Energiespar-
  modus oder im getakteten Mobilfunk **automatisch** große Downloads zurück und
  gibt klar unterscheidbares **Vibrations-Feedback**. (Web: ein kompakter
  „Gerät"-Bereich nutzt die Browser-APIs für Akku, Verbindung und Speicher.)

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
npm test           # 81 End-to-End-Tests (Konto, Kontakte, Medien, Status, Badges, Premium, Admin, Newsroom/Changelog …)
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

Unter **`/admin`** (z. B. `https://<dein-server>/admin`) gibt es ein vollwertiges
Dashboard (Hell-/Dunkel-Theme, Befehls-Palette mit **⌘K**) zum Verwalten von
Ping:

- **Übersicht** – Statistik-Kacheln und Trend-Charts (neue Nutzer & Nachrichten)
  mit umschaltbarem Zeitfenster (7/14/30 Tage) sowie Auto-Refresh.
- **Nutzer** – durchsuchbar, mit Filter-Chips (online/Admins/gesperrt/Premium),
  sortierbaren Spalten und **Mehrfachauswahl** für Sammel-Aktionen
  (Sperren/Entsperren/Löschen). Im Detail: Name/E-Mail/Über-mich/Passwort ändern,
  Admin- und **Premium**-Badge setzen, sperren, Banner- oder „Ping-Team"-Chat-
  Nachricht senden. Das geschützte „Ping-Team"-Systemkonto bleibt unantastbar.
- **Moderation** – alle Chats einsehen (Mitglieder, Nachrichtenzahl, letzte
  Aktivität), einen Chat öffnen, um die letzten Nachrichten zu prüfen, und Chats
  bei Bedarf löschen.
- **Durchsagen** – Push-Durchsage an alle, private „Ping-Team"-Nachricht an alle
  und offizielle **Status für alle** (Text **oder** Bild/Video, Upload direkt im
  Portal), inkl. Verlauf.
- **Inhalte** – **Newsroom-Artikel** (Kategorie, Titelbild) und **Changelog-
  Einträge** (Version, Art) anlegen, bearbeiten, anpinnen, als Entwurf speichern
  oder veröffentlichen — mit **Live-Vorschau** des gerenderten Beitrags.
- **Konfiguration** – Feature-Flags (auch neue hinzufügen), Hinweis-Banner,
  Limits, Einladungs-URL und Mindest-Build — wirkt sofort, ohne App-Update.
- **Audit-Log** – nachvollziehbare, durchsuchbare Historie **jeder** Admin-Aktion
  (wer, was, woran, von welcher IP).
- **System** – Server-Zustand (Version, Uptime, Speicher, Last, Push/SMS),
  aktueller App-Build und **Backups** (auslösen & herunterladen).

Der Zugang geht über das **`ADMIN_TOKEN`** (Header `X-Admin-Token`, timing-sicher
verglichen) **oder** über ein angemeldetes Admin-Konto — Letzteres treibt auch
das **In-App-Admin-Panel** (Einstellungen → Verwaltung) an. In Produktion ohne
gesetztes Token und ohne Admin-Konto bleibt das Portal deaktiviert (`503`). In
der Entwicklung lautet das Token `ping-admin-dev`.

---

## Website

Die öffentliche Marketing-Seite läuft unter der Adresse
**`example.invalid`** und ist eine **Single-Page-App**: ein gemeinsames
Shell (`index.html`) lädt das Design-System (`server/public/site.css` + `site.js`),
und ein Client-Router rendert die einzelnen Ansichten **ohne vollständigen
Seiten-Neuaufbau**. Der Server liefert dasselbe Shell für jede Route aus, sodass
Deep-Links und Vor/Zurück-Navigation nativ funktionieren.

- **`/`** – Startseite mit Live-Statistik, Funktionsüberblick (echte Line-Icons),
  Installationsschritten, **Download-Karte mit Per-ABI-Varianten & SHA-256**,
  Newsroom- & Changelog-Teasern und FAQ.
- **`/news`** (+ `/news/:slug`) – **Newsroom** mit Suche und Kategorie-Filter;
  Einzelartikel mit Lesefortschritts-Balken, Lesezeit und Teilen/Link-kopieren.
- **`/changelog`** – **Changelog** als Timeline, mit Volltext-Suche und Filter
  nach Art der Änderung (Neu/Verbessert/Behoben/Sicherheit).
- **`/status`** – öffentliche **System-Status-Seite**: zeigt live, ob API,
  Echtzeit-Verbindung und Daten-Dienste laufen, inkl. gemessener API-Latenz
  (Sparkline), Live-Zählern und Uptime.
- **`/legal`** – Impressum & Datenschutzerklärung.

Dazu kommen **Hell-/Dunkel-Theme** (mit System-Erkennung, persistiert),
Tastatur-Shortcut `/` für die Suche und ein „Nach oben"-Knopf. Newsroom und
Changelog speisen sich aus der öffentlichen JSON-API (`/api/news`,
`/api/news/:slug`, `/api/changelog`, `/api/public/stats`) und werden im
Admin-Portal unter **Inhalte** gepflegt. Eine Startbefüllung gibt es per
`node scripts/seed-content.mjs` (liest `ADMIN_TOKEN` aus `server/.env`).

---

## Tests & Qualität

```bash
# Backend
cd server && npm test
cd server && node test/webclient-smoke.mjs   # headless Ping-Web Import/Boot-Smoke

# App
cd app && flutter analyze && flutter test
```

Alles oben läuft zusätzlich automatisch in **GitHub Actions** (`.github/workflows/ci.yml`)
bei jedem Push und PR. Release-Builds für **Android** (`android-build.yml`) und
**Windows** (`windows-build.yml`) erzeugst du manuell über den Actions-Tab.

- **Backend:** 170+ Tests decken Registrierung (Nummer + E-Mail + Passwort,
  Pflichtfelder, Dubletten), Anmeldung per Nummer/E-Mail, den privatsphäre-
  schonenden **Telefon-Kontaktabgleich** (E-Mail-Discovery ist abgeschaltet),
  Direktnachrichten per Nummer/ID mit Lesebestätigung über echte WebSockets,
  Gruppen, Bearbeiten/Löschen, Zugriffsschutz, **Medien-Uploads & -Nachrichten**,
  **Status** (posten/sehen/Betrachter), **Blockieren**, Profilbild-Upload sowie
  das Admin-Portal (Token **oder** Admin-Konto) inkl. Durchsagen sowie die
  **Newsroom-/Changelog-Verwaltung** (Entwürfe bleiben privat, öffentliche
  Listen zeigen nur Veröffentlichtes) und die öffentlichen **Live-Statistiken**.
  Geprüft wird außerdem, dass öffentliche Antworten nie Nummer oder E-Mail leaken.
  Dazu kommen Unit-Tests für die **Ping-Web-Logik** (Erwähnungen, Theme-Codes,
  Entwürfe, Insights sowie seit 0.22.0 der **Offline-Cache**, die **Sync-Queue**,
  die **Deeplink-Validierung** und die **Leistungsmetriken**). Seit 0.27.0
  zusätzlich **angepinnte Nachrichten**, **gespeicherte Nachrichten**,
  **Entwurf-Sync**, **Chat-Ordner** (inkl. Eigentums-Prüfung) und die
  **In-Chat-Suche**.
- **App:** Modelle und UI-Widgets sind durch Unit-/Widget-Tests abgedeckt
  (113 Tests), seit 0.26.0 inklusive der **On-Device-Diagnose** (Crash-Erfassung,
  Redaktion, geschützte Zone) und der **opt-in-Statistik** (Zähler, 7-Tage-Reihe);
  seit 0.27.0 die Modelle für **Pins/gespeichert/Entwürfe/Ordner**.

---

## Architektur

```
ping/
├── server/
│   ├── public/
│   │   ├── index.html    # SPA-Shell (für /, /news, /changelog, /status, /legal)
│   │   ├── site.css      # Web-Design-System (Ink-Palette, Hell/Dunkel)
│   │   ├── site.js       # Marketing-SPA: Router + alle Ansichten + Helfer
│   │   └── admin.html    # Admin-Dashboard (statische Seite, tokengeschützt)
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
│       ├── auditRepo.js  # Audit-Log der Admin-Aktionen (SQLite)
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
