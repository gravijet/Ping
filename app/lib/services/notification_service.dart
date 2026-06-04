import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Lightweight wrapper around local notifications. Used to surface incoming
/// messages while the app is in the background. Stays silent on platforms that
/// don't support it so the rest of the app never has to special-case it.
class NotificationService {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;
  void Function(String chatId)? onTapChat;

  static const _channel = AndroidNotificationChannel(
    'ping_messages',
    'Nachrichten',
    description: 'Benachrichtigungen für neue Nachrichten',
    importance: Importance.high,
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
          final chatId = resp.payload;
          if (chatId != null && chatId.isNotEmpty) onTapChat?.call(chatId);
        },
      );
      if (defaultTargetPlatform == TargetPlatform.android) {
        await _plugin
            .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin>()
            ?.createNotificationChannel(_channel);
      }
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  Future<void> requestPermission() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
  }

  Future<void> showMessage({
    required String chatId,
    required String title,
    required String body,
  }) async {
    if (!_ready) return;
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'ping_messages',
        'Nachrichten',
        channelDescription: 'Benachrichtigungen für neue Nachrichten',
        importance: Importance.high,
        priority: Priority.high,
        styleInformation: BigTextStyleInformation(''),
      ),
    );
    // Use the chat id hash as the notification id so new messages in the same
    // chat replace the previous notification instead of stacking endlessly.
    await _plugin.show(
      chatId.hashCode & 0x7fffffff,
      title,
      body,
      details,
      payload: chatId,
    );
  }

  Future<void> cancelForChat(String chatId) async {
    if (!_ready) return;
    await _plugin.cancel(chatId.hashCode & 0x7fffffff);
  }
}
