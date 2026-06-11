import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'notification_target.dart';

/// Lightweight wrapper around local notifications. Used to surface incoming
/// messages and admin announcements while the app is running. Stays silent on
/// platforms that don't support it so the rest of the app never special-cases it.
class NotificationService {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Called when a notification is tapped, with where it should take the user.
  void Function(NotificationTarget target)? onTap;

  static const _messageChannel = AndroidNotificationChannel(
    'ping_messages',
    'Nachrichten',
    description: 'Benachrichtigungen für neue Nachrichten',
    importance: Importance.high,
  );

  static const _announcementChannel = AndroidNotificationChannel(
    'ping_announcements',
    'Durchsagen',
    description: 'Wichtige Hinweise vom Ping-Team',
    importance: Importance.max,
  );

  Future<void> init() async {
    if (_ready) return;
    // Android is the shipped mobile target; the Windows desktop build wires up
    // its own notifier later. Guard everything else so the app never crashes.
    if (defaultTargetPlatform != TargetPlatform.android) {
      return;
    }
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: android);
    try {
      await _plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: (resp) {
          final target = NotificationTarget.decode(resp.payload);
          if (target != null) onTap?.call(target);
        },
      );
      final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(_messageChannel);
      await androidPlugin?.createNotificationChannel(_announcementChannel);
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  /// If the app was cold-launched by tapping a *local* notification, return its
  /// target so the caller can route to it once the UI is ready. (FCM tray taps
  /// are handled separately by firebase_messaging's getInitialMessage.)
  Future<NotificationTarget?> launchTarget() async {
    if (defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      final details = await _plugin.getNotificationAppLaunchDetails();
      if (details?.didNotificationLaunchApp == true) {
        return NotificationTarget.decode(details!.notificationResponse?.payload);
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  Future<void> requestPermission() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
  }

  /// Show a notification. [target] decides where a tap routes; for messages it
  /// also de-duplicates (same chat replaces its previous notification).
  Future<void> showMessage({
    required String title,
    required String body,
    required NotificationTarget target,
    bool announcement = false,
  }) async {
    if (!_ready) return;
    final channel = announcement ? _announcementChannel : _messageChannel;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        channel.id,
        channel.name,
        channelDescription: channel.description,
        importance: announcement ? Importance.max : Importance.high,
        priority: Priority.high,
        category:
            announcement ? AndroidNotificationCategory.social : null,
        styleInformation: const BigTextStyleInformation(''),
      ),
    );
    // Group message notifications per chat (replace previous); give each
    // announcement its own slot so they stack.
    final id = (target.chatId ?? target.route ?? body).hashCode & 0x7fffffff;
    await _plugin.show(id, title, body, details, payload: target.encode());
  }

  Future<void> cancelForChat(String chatId) async {
    if (!_ready) return;
    await _plugin.cancel(chatId.hashCode & 0x7fffffff);
  }
}
