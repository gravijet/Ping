import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'notification_target.dart';

// Action ids for the message-notification buttons (direct reply + mark read).
const String _kReplyAction = 'msg_reply';
const String _kMarkReadAction = 'msg_markread';

// SharedPreferences keys the background isolate reads to reach the server — they
// must match the ones AppState writes (app_state.dart: _kToken / _kBaseUrl).
const String _kPrefToken = 'ping_token';
const String _kPrefBaseUrl = 'ping_base_url';

String _apiRoot(String baseUrl) {
  final b = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
  return '$b/api';
}

/// Handles a Reply / "Mark read" notification action that fired while the app
/// was in the background or terminated. Runs in its own isolate, so it can't
/// touch AppState — it reads the persisted session straight from
/// SharedPreferences and talks to the server over HTTP itself.
///
/// Must be a top-level function annotated `vm:entry-point` so the engine can
/// find it after a cold start.
@pragma('vm:entry-point')
Future<void> notificationActionBackground(NotificationResponse resp) async {
  final action = resp.actionId;
  if (action != _kReplyAction && action != _kMarkReadAction) return;
  final target = NotificationTarget.decode(resp.payload);
  final chatId = target?.chatId;
  if (chatId == null || chatId.isEmpty) return;

  try {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_kPrefToken);
    final baseUrl = prefs.getString(_kPrefBaseUrl);
    if (token == null || token.isEmpty || baseUrl == null || baseUrl.isEmpty) return;
    final root = _apiRoot(baseUrl);
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };
    if (action == _kReplyAction) {
      final text = (resp.input ?? '').trim();
      if (text.isEmpty) return;
      await http.post(
        Uri.parse('$root/chats/$chatId/messages'),
        headers: headers,
        body: jsonEncode({'body': text}),
      );
    }
    // Either action implicitly clears the unread state for that chat.
    await http.post(Uri.parse('$root/chats/$chatId/read'), headers: headers);
    // Take the notification down — the reply was sent / the chat is read.
    await FlutterLocalNotificationsPlugin().cancel(resp.id ?? (chatId.hashCode & 0x7fffffff));
  } catch (_) {
    /* offline / transient — the chat reconciles itself on next open */
  }
}

/// Lightweight wrapper around local notifications. Used to surface incoming
/// messages and admin announcements while the app is running. Stays silent on
/// platforms that don't support it so the rest of the app never special-cases it.
class NotificationService {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Called when a notification is tapped, with where it should take the user.
  void Function(NotificationTarget target)? onTap;

  /// Called when the user taps Accept/Decline on an incoming-call notification.
  void Function(String callId, String callerId, bool video, bool accept)?
      onCallAction;

  /// Called when the user sends a direct reply from a message notification
  /// (foreground). The background/terminated case is handled out-of-isolate by
  /// [notificationActionBackground].
  void Function(String chatId, String text)? onReply;

  /// Called when the user taps "Als gelesen" on a message notification (foreground).
  void Function(String chatId)? onMarkRead;

  /// Fixed id for the (single) incoming-call notification, so it can be replaced
  /// and cancelled deterministically.
  static const int _callNotificationId = 911000;

  /// Notification-group key under which per-chat message notifications stack.
  static const String _messageGroup = 'ping.messages';

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

  static const _statusChannel = AndroidNotificationChannel(
    'ping_status',
    'Status-Updates',
    description: 'Wenn Kontakte einen neuen Status teilen',
    importance: Importance.defaultImportance,
  );

  static const _callChannel = AndroidNotificationChannel(
    'ping_calls',
    'Anrufe',
    description: 'Eingehende Sprach- und Videoanrufe',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
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
        onDidReceiveNotificationResponse: _onResponse,
        // Action buttons (reply / mark read) tapped while the app is in the
        // background or terminated land in their own isolate.
        onDidReceiveBackgroundNotificationResponse: notificationActionBackground,
      );
      final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(_messageChannel);
      await androidPlugin?.createNotificationChannel(_announcementChannel);
      await androidPlugin?.createNotificationChannel(_statusChannel);
      await androidPlugin?.createNotificationChannel(_callChannel);
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  void _onResponse(NotificationResponse resp) {
    final payload = resp.payload ?? '';
    // Incoming-call actions / tap.
    final call = _decodeCall(payload);
    if (call != null) {
      final accept = resp.actionId != 'call_decline';
      onCallAction?.call(call.$1, call.$2, call.$3, accept);
      return;
    }
    final target = NotificationTarget.decode(payload);
    // Direct-reply / mark-read actions on a message notification (foreground).
    if (target?.chatId != null) {
      if (resp.actionId == _kReplyAction) {
        final text = (resp.input ?? '').trim();
        if (text.isNotEmpty) onReply?.call(target!.chatId!, text);
        return;
      }
      if (resp.actionId == _kMarkReadAction) {
        onMarkRead?.call(target!.chatId!);
        return;
      }
    }
    if (target != null) onTap?.call(target);
  }

  /// Parse a `call:<callId>:<callerId>:<video>` payload, or null.
  static (String, String, bool)? _decodeCall(String payload) {
    if (!payload.startsWith('call:')) return null;
    final parts = payload.substring(5).split(':');
    if (parts.isEmpty || parts[0].isEmpty) return null;
    return (
      parts[0],
      parts.length > 1 ? parts[1] : '',
      parts.length > 2 && parts[2] == '1',
    );
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
      await _guard(() async {
        await _plugin
            .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin>()
            ?.requestNotificationsPermission();
      });
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
    // Honour the Quick Settings "snooze" tile (PingTileService): while the snooze
    // window is in the future, drop chat-message notifications entirely. Reads
    // the same pref the tile writes; works in the background isolate too.
    // Announcements/calls intentionally bypass it.
    if (!announcement && target.chatId != null && await _isSnoozed()) return;
    final channel = announcement ? _announcementChannel : _messageChannel;
    // Real chat messages get inline "Antworten" (direct reply) + "Gelesen"
    // actions — replying or clearing the chat straight from the notification
    // shade, without ever opening the app. Announcements stay action-less.
    final isChat = !announcement && target.chatId != null;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        channel.id,
        channel.name,
        channelDescription: channel.description,
        importance: announcement ? Importance.max : Importance.high,
        priority: Priority.high,
        category: announcement
            ? AndroidNotificationCategory.social
            : AndroidNotificationCategory.message,
        styleInformation: const BigTextStyleInformation(''),
        // Stack message notifications under a single group so the shade shows
        // one tidy "Ping" bundle rather than N loose cards.
        groupKey: isChat ? _messageGroup : null,
        actions: isChat
            ? <AndroidNotificationAction>[
                const AndroidNotificationAction(
                  _kReplyAction,
                  'Antworten',
                  inputs: <AndroidNotificationActionInput>[
                    AndroidNotificationActionInput(label: 'Nachricht …'),
                  ],
                ),
                const AndroidNotificationAction(
                  _kMarkReadAction,
                  'Gelesen',
                  cancelNotification: true,
                ),
              ]
            : null,
      ),
    );
    // Group message notifications per chat (replace previous); give each
    // announcement its own slot so they stack.
    final id = (target.chatId ?? target.route ?? body).hashCode & 0x7fffffff;
    await _guard(() => _plugin.show(id, title, body, details, payload: target.encode()));
  }

  /// True while the Quick Settings snooze tile has muted notifications. Reads
  /// the shared pref the tile (PingTileService) writes.
  Future<bool> _isSnoozed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final until = prefs.getInt('ping_snooze_until') ?? 0;
      return DateTime.now().millisecondsSinceEpoch < until;
    } catch (_) {
      return false;
    }
  }

  /// Runs a notification-plugin call defensively. The native
  /// flutter_local_notifications layer can throw PlatformExceptions on some
  /// devices/ROMs (seen in the wild: "Missing type parameter" out of cancel()).
  /// A notification failing to show or clear is never worth crashing the app.
  Future<void> _guard(Future<void> Function() op) async {
    try {
      await op();
    } catch (_) {/* best-effort: notifications never crash the app */}
  }

  Future<void> cancelForChat(String chatId) async {
    if (!_ready) return;
    await _guard(() => _plugin.cancel(chatId.hashCode & 0x7fffffff));
  }

  /// A quiet "new status" notification on the status channel.
  Future<void> showStatus({required String name}) async {
    if (!_ready) return;
    await _guard(() => _plugin.show(
      'status:$name'.hashCode & 0x7fffffff,
      name,
      'hat einen neuen Status geteilt',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'ping_status',
          'Status-Updates',
          channelDescription: 'Wenn Kontakte einen neuen Status teilen',
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
        ),
      ),
      payload: const NotificationTarget(route: 'status').encode(),
    ));
  }

  /// Show the full-screen incoming-call notification (rings the device even when
  /// the app is in the background or closed) with Accept/Decline actions.
  Future<void> showIncomingCall({
    required String callId,
    required String callerName,
    required bool video,
    String callerId = '',
  }) async {
    if (!_ready) return;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        'ping_calls',
        'Anrufe',
        channelDescription: 'Eingehende Sprach- und Videoanrufe',
        importance: Importance.max,
        priority: Priority.max,
        category: AndroidNotificationCategory.call,
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: false,
        playSound: true,
        enableVibration: true,
        timeoutAfter: 45000,
        actions: const [
          AndroidNotificationAction('call_decline', 'Ablehnen',
              cancelNotification: true),
          AndroidNotificationAction('call_accept', 'Annehmen',
              cancelNotification: true, showsUserInterface: true),
        ],
      ),
    );
    await _guard(() => _plugin.show(
      _callNotificationId,
      callerName,
      video ? 'Eingehender Videoanruf' : 'Eingehender Anruf',
      details,
      payload: 'call:$callId:$callerId:${video ? '1' : '0'}',
    ));
  }

  Future<void> cancelIncomingCall() async {
    if (!_ready) return;
    await _guard(() => _plugin.cancel(_callNotificationId));
  }

  /// If the app was cold-launched by tapping/accepting an incoming-call
  /// notification, return the call so the app can ask the caller to re-send the
  /// offer and connect. Returns null on a plain launch or an explicit decline.
  Future<({String callId, String callerId, bool video, bool accept})?>
      launchCall() async {
    if (defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      final details = await _plugin.getNotificationAppLaunchDetails();
      final resp = details?.notificationResponse;
      if (details?.didNotificationLaunchApp != true || resp == null) return null;
      final call = _decodeCall(resp.payload ?? '');
      if (call == null) return null;
      return (
        callId: call.$1,
        callerId: call.$2,
        video: call.$3,
        accept: resp.actionId != 'call_decline',
      );
    } catch (_) {
      return null;
    }
  }

  /// A "missed call" entry after an unanswered/cancelled incoming call.
  Future<void> showMissedCall({required String name}) async {
    if (!_ready) return;
    await _guard(() => _plugin.show(
      'missed:$name${DateTime.now().millisecondsSinceEpoch ~/ 1000}'.hashCode &
          0x7fffffff,
      'Verpasster Anruf',
      name,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'ping_calls',
          'Anrufe',
          channelDescription: 'Eingehende Sprach- und Videoanrufe',
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.missedCall,
        ),
      ),
      payload: const NotificationTarget(route: 'calls').encode(),
    ));
  }
}
