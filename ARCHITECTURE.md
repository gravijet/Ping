# Architecture

The Flutter client uses REST for account and history operations and WebSocket messages for realtime chat events. The Node.js server stores account and message data in SQLite.

Push notifications use an optional Firebase service account. WebRTC calls can use locally configured STUN and TURN services.
