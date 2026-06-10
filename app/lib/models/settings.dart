import 'dart:convert';

/// All the user-tweakable preferences that live only on the device. Persisted
/// as a single JSON blob in shared_preferences.
class PingSettings {
  // Privacy
  final bool readReceipts; // send read receipts to others
  final bool showOnline; // (cosmetic) advertise presence

  // Notifications
  final bool notificationsEnabled;
  final bool notificationPreview; // include message text in the notification
  final bool notificationVibrate;

  // Chats
  final bool enterToSend;
  final double fontScale; // 0.85 .. 1.4
  final int wallpaper; // legacy preset index into kChatWallpapers
  final String wallpaperSpec; // global chat background (see WallpaperSpec)

  // Appearance / design
  final String designId; // id of a PingDesign preset, or 'custom'
  final int? customColor; // seed colour (ARGB) when designId == 'custom'

  // Read aloud (text-to-speech)
  final bool ttsEnabled; // show "read aloud" actions
  final bool ttsAutoRead; // auto-read incoming messages in the open chat
  final String ttsLanguage;
  final double ttsRate;
  final double ttsPitch;

  const PingSettings({
    this.readReceipts = true,
    this.showOnline = true,
    this.notificationsEnabled = true,
    this.notificationPreview = true,
    this.notificationVibrate = true,
    this.enterToSend = false,
    this.fontScale = 1.0,
    this.wallpaper = 0,
    this.wallpaperSpec = '',
    this.designId = 'ocean',
    this.customColor,
    this.ttsEnabled = false,
    this.ttsAutoRead = false,
    this.ttsLanguage = 'de-DE',
    this.ttsRate = 0.5,
    this.ttsPitch = 1.0,
  });

  PingSettings copyWith({
    bool? readReceipts,
    bool? showOnline,
    bool? notificationsEnabled,
    bool? notificationPreview,
    bool? notificationVibrate,
    bool? enterToSend,
    double? fontScale,
    int? wallpaper,
    String? wallpaperSpec,
    String? designId,
    int? customColor,
    bool clearCustomColor = false,
    bool? ttsEnabled,
    bool? ttsAutoRead,
    String? ttsLanguage,
    double? ttsRate,
    double? ttsPitch,
  }) =>
      PingSettings(
        readReceipts: readReceipts ?? this.readReceipts,
        showOnline: showOnline ?? this.showOnline,
        notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
        notificationPreview: notificationPreview ?? this.notificationPreview,
        notificationVibrate: notificationVibrate ?? this.notificationVibrate,
        enterToSend: enterToSend ?? this.enterToSend,
        fontScale: fontScale ?? this.fontScale,
        wallpaper: wallpaper ?? this.wallpaper,
        wallpaperSpec: wallpaperSpec ?? this.wallpaperSpec,
        designId: designId ?? this.designId,
        customColor:
            clearCustomColor ? null : (customColor ?? this.customColor),
        ttsEnabled: ttsEnabled ?? this.ttsEnabled,
        ttsAutoRead: ttsAutoRead ?? this.ttsAutoRead,
        ttsLanguage: ttsLanguage ?? this.ttsLanguage,
        ttsRate: ttsRate ?? this.ttsRate,
        ttsPitch: ttsPitch ?? this.ttsPitch,
      );

  Map<String, dynamic> toJson() => {
        'readReceipts': readReceipts,
        'showOnline': showOnline,
        'notificationsEnabled': notificationsEnabled,
        'notificationPreview': notificationPreview,
        'notificationVibrate': notificationVibrate,
        'enterToSend': enterToSend,
        'fontScale': fontScale,
        'wallpaper': wallpaper,
        'wallpaperSpec': wallpaperSpec,
        'designId': designId,
        'customColor': customColor,
        'ttsEnabled': ttsEnabled,
        'ttsAutoRead': ttsAutoRead,
        'ttsLanguage': ttsLanguage,
        'ttsRate': ttsRate,
        'ttsPitch': ttsPitch,
      };

  factory PingSettings.fromJson(Map<String, dynamic> j) => PingSettings(
        readReceipts: j['readReceipts'] ?? true,
        showOnline: j['showOnline'] ?? true,
        notificationsEnabled: j['notificationsEnabled'] ?? true,
        notificationPreview: j['notificationPreview'] ?? true,
        notificationVibrate: j['notificationVibrate'] ?? true,
        enterToSend: j['enterToSend'] ?? false,
        fontScale: (j['fontScale'] as num?)?.toDouble() ?? 1.0,
        wallpaper: j['wallpaper'] ?? 0,
        designId: (j['designId'] as String?) ?? 'ocean',
        customColor: j['customColor'] as int?,
        wallpaperSpec: (j['wallpaperSpec'] as String?) ??
            // Migrate the legacy preset index into the new spec form.
            ((j['wallpaper'] ?? 0) is int && (j['wallpaper'] ?? 0) > 0
                ? 'color:${j['wallpaper']}'
                : ''),
        ttsEnabled: j['ttsEnabled'] ?? false,
        ttsAutoRead: j['ttsAutoRead'] ?? false,
        ttsLanguage: j['ttsLanguage'] ?? 'de-DE',
        ttsRate: (j['ttsRate'] as num?)?.toDouble() ?? 0.5,
        ttsPitch: (j['ttsPitch'] as num?)?.toDouble() ?? 1.0,
      );

  static PingSettings decode(String? raw) {
    if (raw == null || raw.isEmpty) return const PingSettings();
    try {
      return PingSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return const PingSettings();
    }
  }

  String encode() => jsonEncode(toJson());
}

/// Selectable chat wallpapers. Each is a pair of gradient-ish base colours that
/// blend with the brightness; index 0 means "use the theme default".
const kChatWallpapers = [
  0xFF0A84FF, // default (sentinel — handled specially)
  0xFF1E3A5F,
  0xFF11512E,
  0xFF4A2C5E,
  0xFF5E3A1E,
  0xFF263238,
];
