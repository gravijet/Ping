import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'notification_service.dart';
import 'notification_target.dart';

/// Top-level background handler. Required by firebase_messaging. Messages that
/// carry a `notification` block are shown by the OS automatically while the app
/// is in the background or terminated, so there is nothing to do here — but the
/// handler must exist and be registered for FCM to deliver reliably.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // No-op: the system tray displays the notification payload itself.
}

/// Wires Firebase Cloud Messaging into the app: obtains the device token (so the
/// server can push to it), shows foreground messages as local notifications, and
/// routes notification taps to the right chat or screen. Android-only for now;
/// silently does nothing elsewhere so the rest of the app never special-cases it.
class PushService {
  final _messaging = FirebaseMessaging.instance;
  NotificationService? _notifications;
  bool _started = false;

  /// Called with the FCM token on start and whenever it refreshes — the app
  /// registers it with the server here.
  void Function(String token)? onToken;

  /// Called when a push notification is tapped (background/terminated launch),
  /// with where it should take the user.
  void Function(NotificationTarget target)? onOpen;

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
    final n = message.notification;
    if (n == null) return;
    final data = message.data;
    final target =
        NotificationTarget.fromData(data) ?? const NotificationTarget();
    _notifications?.showMessage(
      title: n.title ?? 'Ping',
      body: n.body ?? '',
      target: target,
      announcement: (data['type'] ?? '').toString() == 'announcement',
    );
  }

  void _onOpened(RemoteMessage message) {
    final target = NotificationTarget.fromData(message.data);
    if (target != null) onOpen?.call(target);
  }
}
