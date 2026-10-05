# Ping

Experimental Flutter messenger with a Node.js realtime backend. Includes accounts, direct and group chats, media, contact matching and WebRTC calls.

The application is still under development. Android is the primary target; desktop support and calls need testing on the target devices and networks.

## Backend

Requires Node.js 22.5 or newer.

```sh
cd server
npm install
cp .env.example .env
npm start
npm test
```

Set session and administration secrets locally. Databases, uploaded files, Firebase credentials and signing material are excluded from Git.

## App

```sh
cd app
flutter pub get
flutter test
flutter build apk --debug
```

Configure the backend URL for your own instance. Firebase push notifications require a local `google-services.json` and a server-side service account. Release signing uses a private keystore.
