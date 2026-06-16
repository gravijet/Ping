import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'notification_service.dart';
import 'notification_target.dart';

/// Top-level background handler. Required by firebase_messaging. Messages that
/// carry a `notification` block are shown by the OS automatically while the app
/// is in the background or terminated. *Calls* are sent as silent data messages,
/// so we draw their full-screen incoming-call notification ourselves here (and
/// dismiss it on a matching cancel).
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  final data = message.data;
  final type = (data['type'] ?? '').toString();
  if (type == 'call') {
    final svc = NotificationService();
    await svc.init();
    await svc.showIncomingCall(
      callId: (data['callId'] ?? '').toString(),
      callerName: (data['callerName'] ?? 'Anruf').toString(),
      video: (data['video'] ?? '').toString() == '1',
      callerId: (data['callerId'] ?? '').toString(),
    );
  } else if (type == 'call-cancel') {
    final svc = NotificationService();
    await svc.init();
    await svc.cancelIncomingCall();
  }
  // Everything else carries a notification block the system tray shows itself.
}

/// Wires Firebase Cloud Messaging into the app: obtains the device token (so the
/// server can push to it), shows foreground messages as local notifications, and
/// routes notification taps to the right chat or screen. Android-only for now;
/// silently does nothing elsewhere so the rest of the app never special-cases it.
class PushService {
  // Lazy on purpose: `FirebaseMessaging.instance` reaches for an initialized
  // Firebase app, which only exists on Android (main.dart inits Firebase there).
  // Evaluating it eagerly would throw on the Windows desktop build, where the
  // PushService is still constructed but never started. Every use sits behind a
  // [_supported] (Android) guard, so this getter is never touched off-Android.
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;
  NotificationService? _notifications;
  bool _started = false;

  /// Called with the FCM token on start and whenever it refreshes — the app
  /// registers it with the server here.
  void Function(String token)? onToken;

  /// Called when a push notification is tapped (background/terminated launch),
  /// with where it should take the user.
  void Function(NotificationTarget target)? onOpen;

  /// Called for a foreground incoming-call data push (the phone is already awake).
  void Function(
          String callId, String callerId, String callerName, bool video)?
      onIncomingCall;

  /// Called for a foreground call-cancel data push (caller hung up / timed out).
  void Function(String callId)? onCallCanceled;

  bool get _supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> start({required NotificationService notifications}) async {
    if (_started || !_supported) return;
    _started = true;
    _notifications = notifications;

    try {
      await _messaging.requestPermission();

      FirebaseMessaging.onMessage.listen(_onForeground);
      FirebaseMessaging.onMessageOpenedApp.listen(_onOpened);
      _messaging.onTokenRefresh.listen((t) => onToken?.call(t));

      final token = await _messaging.getToken();
      if (token != null && token.isNotEmpty) onToken?.call(token);

      // Cold start from a tapped notification.
      final initial = await _messaging.getInitialMessage();
      if (initial != null) _onOpened(initial);
    } catch (_) {
      _started = false;
    }
  }

  /// The current device token (or null if unavailable), used to unregister on
  /// logout.
  Future<String?> currentToken() async {
    if (!_supported) return null;
    try {
      return await _messaging.getToken();
    } catch (_) {
      return null;
    }
  }

  void _onForeground(RemoteMessage message) {
    final data = message.data;
    final type = (data['type'] ?? '').toString();
    // Calls are silent data messages handled by the live call layer, not the tray.
    if (type == 'call') {
      onIncomingCall?.call(
        (data['callId'] ?? '').toString(),
        (data['callerId'] ?? '').toString(),
        (data['callerName'] ?? 'Anruf').toString(),
        (data['video'] ?? '').toString() == '1',
      );
      return;
    }
    if (type == 'call-cancel') {
      onCallCanceled?.call((data['callId'] ?? '').toString());
      return;
    }
    final n = message.notification;
    if (n == null) return;
    final target =
        NotificationTarget.fromData(data) ?? const NotificationTarget();
    _notifications?.showMessage(
      title: n.title ?? 'Ping',
      body: n.body ?? '',
      target: target,
      announcement: type == 'announcement',
    );
  }

  void _onOpened(RemoteMessage message) {
    final target = NotificationTarget.fromData(message.data);
    if (target != null) onOpen?.call(target);
  }
}
