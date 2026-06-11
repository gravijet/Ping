/// Where a tapped notification should take the user. Either a specific [chatId]
/// (new-message notifications) or a named in-app [route] (admin announcements
/// that deep-link to a screen, e.g. the privacy settings).
///
/// It serialises to/from a compact payload string for flutter_local_notifications
/// and from the FCM `data` map, so the same routing logic handles taps whether
/// the app was open, backgrounded or fully terminated.
class NotificationTarget {
  final String? chatId;
  final String? route;

  const NotificationTarget({this.chatId, this.route});

  /// Compact payload for a local notification (flutter_local_notifications).
  String encode() =>
      chatId != null ? 'chat:$chatId' : 'route:${route ?? 'home'}';

  static NotificationTarget? decode(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    if (payload.startsWith('chat:')) {
      final id = payload.substring(5);
      return id.isEmpty ? null : NotificationTarget(chatId: id);
    }
    if (payload.startsWith('route:')) {
      final r = payload.substring(6);
      return r.isEmpty ? null : NotificationTarget(route: r);
    }
    // Legacy payloads were a bare chat id.
    return NotificationTarget(chatId: payload);
  }

  /// Build a target from an FCM `data` map (background/terminated taps).
  static NotificationTarget? fromData(Map<String, dynamic> data) {
    final chatId = (data['chatId'] ?? '').toString();
    if (chatId.isNotEmpty) return NotificationTarget(chatId: chatId);
    final route = (data['route'] ?? '').toString();
    if (route.isNotEmpty) return NotificationTarget(route: route);
    if ((data['type'] ?? '').toString() == 'announcement') {
      return const NotificationTarget(route: 'home');
    }
    return null;
  }

  bool get isChat => chatId != null;
}
