import 'dart:convert';

/// An app-wide banner pushed from the server via remote config — a way to tell
/// every user something (maintenance, an outage, a new feature) without shipping
/// an app update or sending a push.
class RemoteNotice {
  final String text;
  final String level; // 'info' | 'warning' | 'critical'
  final String? route; // optional deep-link the banner's action opens

  const RemoteNotice({required this.text, this.level = 'info', this.route});

  bool get critical => level == 'critical';

  factory RemoteNotice.fromJson(Map<String, dynamic> j) => RemoteNotice(
        text: (j['text'] ?? '') as String,
        level: (j['level'] ?? 'info') as String,
        route: j['route'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'text': text,
        'level': level,
        if (route != null) 'route': route,
      };
}

/// Server-driven runtime configuration: feature flags, tunable values, an
/// optional notice banner and the minimum supported Android build. Fetched from
/// `/api/config` and cached locally so it's available instantly and offline.
class RemoteConfig {
  final Map<String, bool> flags;
  final Map<String, dynamic> values;
  final RemoteNotice? notice;
  final int minSupportedBuild;

  const RemoteConfig({
    this.flags = const {},
    this.values = const {},
    this.notice,
    this.minSupportedBuild = 0,
  });

  static const empty = RemoteConfig();

  /// Whether a feature flag is on. Unknown flags fall back to [fallback] so a
  /// brand-new client that the server doesn't know about still behaves sanely.
  bool flag(String name, {bool fallback = false}) => flags[name] ?? fallback;

  int intValue(String name, int fallback) {
    final v = values[name];
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v) ?? fallback;
    return fallback;
  }

  String stringValue(String name, [String fallback = '']) {
    final v = values[name];
    return v is String ? v : fallback;
  }

  factory RemoteConfig.fromJson(Map<String, dynamic> j) => RemoteConfig(
        flags: ((j['flags'] as Map?) ?? const {})
            .map((k, v) => MapEntry(k as String, v == true)),
        values: ((j['values'] as Map?) ?? const {})
            .map((k, v) => MapEntry(k as String, v)),
        notice: j['notice'] is Map
            ? RemoteNotice.fromJson((j['notice'] as Map).cast<String, dynamic>())
            : null,
        minSupportedBuild:
            (j['minSupportedBuild'] is num) ? (j['minSupportedBuild'] as num).toInt() : 0,
      );

  Map<String, dynamic> toJson() => {
        'flags': flags,
        'values': values,
        if (notice != null) 'notice': notice!.toJson(),
        'minSupportedBuild': minSupportedBuild,
      };

  String encode() => jsonEncode(toJson());

  static RemoteConfig decode(String? s) {
    if (s == null || s.isEmpty) return empty;
    try {
      return RemoteConfig.fromJson(jsonDecode(s) as Map<String, dynamic>);
    } catch (_) {
      return empty;
    }
  }
}
