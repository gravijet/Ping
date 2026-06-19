import 'dart:convert';

/// All the user-tweakable preferences that live only on the device. Persisted
/// as a single JSON blob in shared_preferences.
class PingSettings {
  // Privacy
  final bool readReceipts; // send read receipts to others
  final bool sendTypingIndicators; // tell others when you're typing

  // Notifications
  final bool notificationsEnabled;
  final bool notificationPreview; // include message text in the notification
  final bool notificationVibrate;
  final bool callRingtone; // play a ringtone (incoming) / ringback (outgoing)

  // Chats
  final bool enterToSend;
  final double fontScale; // 0.85 .. 1.4
  final int wallpaper; // legacy preset index into kChatWallpapers
  final String wallpaperSpec; // global chat background (see WallpaperSpec)

  // Appearance / design
  final String designId; // id of a PingDesign preset, or 'custom'
  final int? customColor; // seed colour (ARGB) when designId == 'custom'
  final bool amoledDark; // pure-black surfaces in dark mode (saves OLED battery)
  final bool reduceMotion; // minimise animations/transitions
  final bool boldText; // heavier type weights everywhere (accessibility)
  final bool highContrast; // stronger borders/dividers for legibility
  final double bubbleCorners; // chat-bubble roundness multiplier (0.4 .. 1.6)

  // Notifications — quiet hours (suppress message alerts in a daily window)
  final bool quietHoursEnabled;
  final int quietStart; // minutes after midnight, e.g. 22:00 -> 1320
  final int quietEnd; // minutes after midnight, e.g. 07:00 -> 420

  // Data & storage
  final bool dataSaver; // smaller image cache + no media auto-prefetch

  // Read aloud (text-to-speech)
  final bool ttsEnabled; // show "read aloud" actions
  final bool ttsAutoRead; // auto-read incoming messages in the open chat
  final String ttsLanguage;
  final double ttsRate;
  final double ttsPitch;

  // Chats — presentation
  final bool clock24h; // 24-hour time (vs. 12-hour with am/pm)
  final bool compactChats; // denser chat-list rows (more chats per screen)
  final bool bigEmoji; // render emoji-only messages extra-large
  final bool hideListPreview; // hide the last-message text in the chat list

  // Feedback
  final bool inAppSounds; // play a soft cue on send / incoming message
  final bool hapticFeedback; // vibrate on key interactions

  // App lock — a local PIN gate over the whole app
  final bool appLockEnabled;
  final String appLockPinHash; // salted sha-256 of the PIN ('' when unset)
  final int appLockGraceSeconds; // re-lock after this long in the background

  // Chats — list & bubbles
  final String chatSort; // 'recent' | 'unread' | 'alpha' (see ChatSort)
  final bool accentBubbles; // tint my bubbles toward the accent for a bolder look
  final bool messageFormatting; // render *bold* / _italic_ / ~strike~ / `code`
  final double wallpaperDim; // 0.0 .. 0.6 — darken chat backgrounds for contrast
  final String swipeRightAction; // 'pin' | 'mute' | 'none' (see kSwipeRightActions)

  // App behaviour
  final int startTab; // which home tab opens on launch (0 Chats, 1 Status, 2 Anrufe)
  final bool incognitoKeyboard; // ask the keyboard not to learn from what you type
  final bool confirmBeforeDelete; // double-check before deleting messages/chats

  // Quick replies — canned messages insertable from the composer
  final List<String> quickReplies;

  // Profile / social
  final bool showContactMood; // show a contact's status/mood in the chat header
  final bool chatListMoodEmoji; // show a contact's mood emoji in the chat list

  // Diagnostics & developer (all on-device, opt-in)
  final bool collectMetrics; // count my own actions for "Deine Statistik" (local)
  final bool devOptionsUnlocked; // 7-tap-on-version unlock for the dev panel
  final bool showPerformanceOverlay; // overlay Flutter's GPU/UI frame graphs

  const PingSettings({
    this.readReceipts = true,
    this.sendTypingIndicators = true,
    this.notificationsEnabled = true,
    this.notificationPreview = true,
    this.notificationVibrate = true,
    this.callRingtone = true,
    this.enterToSend = false,
    this.fontScale = 1.0,
    this.wallpaper = 0,
    this.wallpaperSpec = '',
    this.designId = 'ocean',
    this.customColor,
    this.amoledDark = false,
    this.reduceMotion = false,
    this.boldText = false,
    this.highContrast = false,
    this.bubbleCorners = 1.0,
    this.quietHoursEnabled = false,
    this.quietStart = 1320, // 22:00
    this.quietEnd = 420, // 07:00
    this.dataSaver = false,
    this.ttsEnabled = false,
    this.ttsAutoRead = false,
    this.ttsLanguage = 'de-DE',
    this.ttsRate = 0.5,
    this.ttsPitch = 1.0,
    this.clock24h = true,
    this.compactChats = false,
    this.bigEmoji = true,
    this.hideListPreview = false,
    this.inAppSounds = true,
    this.hapticFeedback = true,
    this.appLockEnabled = false,
    this.appLockPinHash = '',
    this.appLockGraceSeconds = 0,
    this.chatSort = 'recent',
    this.accentBubbles = false,
    this.messageFormatting = true,
    this.wallpaperDim = 0.0,
    this.swipeRightAction = 'pin',
    this.startTab = 0,
    this.incognitoKeyboard = false,
    this.confirmBeforeDelete = true,
    this.quickReplies = kDefaultQuickReplies,
    this.showContactMood = true,
    this.chatListMoodEmoji = true,
    this.collectMetrics = false,
    this.devOptionsUnlocked = false,
    this.showPerformanceOverlay = false,
  });

  PingSettings copyWith({
    bool? readReceipts,
    bool? sendTypingIndicators,
    bool? notificationsEnabled,
    bool? notificationPreview,
    bool? notificationVibrate,
    bool? callRingtone,
    bool? enterToSend,
    double? fontScale,
    int? wallpaper,
    String? wallpaperSpec,
    String? designId,
    int? customColor,
    bool clearCustomColor = false,
    bool? amoledDark,
    bool? reduceMotion,
    bool? boldText,
    bool? highContrast,
    double? bubbleCorners,
    bool? quietHoursEnabled,
    int? quietStart,
    int? quietEnd,
    bool? dataSaver,
    bool? ttsEnabled,
    bool? ttsAutoRead,
    String? ttsLanguage,
    double? ttsRate,
    double? ttsPitch,
    bool? clock24h,
    bool? compactChats,
    bool? bigEmoji,
    bool? hideListPreview,
    bool? inAppSounds,
    bool? hapticFeedback,
    bool? appLockEnabled,
    String? appLockPinHash,
    int? appLockGraceSeconds,
    String? chatSort,
    bool? accentBubbles,
    bool? messageFormatting,
    double? wallpaperDim,
    String? swipeRightAction,
    int? startTab,
    bool? incognitoKeyboard,
    bool? confirmBeforeDelete,
    List<String>? quickReplies,
    bool? showContactMood,
    bool? chatListMoodEmoji,
    bool? collectMetrics,
    bool? devOptionsUnlocked,
    bool? showPerformanceOverlay,
  }) =>
      PingSettings(
        readReceipts: readReceipts ?? this.readReceipts,
        sendTypingIndicators:
            sendTypingIndicators ?? this.sendTypingIndicators,
        notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
        notificationPreview: notificationPreview ?? this.notificationPreview,
        notificationVibrate: notificationVibrate ?? this.notificationVibrate,
        callRingtone: callRingtone ?? this.callRingtone,
        enterToSend: enterToSend ?? this.enterToSend,
        fontScale: fontScale ?? this.fontScale,
        wallpaper: wallpaper ?? this.wallpaper,
        wallpaperSpec: wallpaperSpec ?? this.wallpaperSpec,
        designId: designId ?? this.designId,
        customColor:
            clearCustomColor ? null : (customColor ?? this.customColor),
        amoledDark: amoledDark ?? this.amoledDark,
        reduceMotion: reduceMotion ?? this.reduceMotion,
        boldText: boldText ?? this.boldText,
        highContrast: highContrast ?? this.highContrast,
        bubbleCorners: bubbleCorners ?? this.bubbleCorners,
        quietHoursEnabled: quietHoursEnabled ?? this.quietHoursEnabled,
        quietStart: quietStart ?? this.quietStart,
        quietEnd: quietEnd ?? this.quietEnd,
        dataSaver: dataSaver ?? this.dataSaver,
        ttsEnabled: ttsEnabled ?? this.ttsEnabled,
        ttsAutoRead: ttsAutoRead ?? this.ttsAutoRead,
        ttsLanguage: ttsLanguage ?? this.ttsLanguage,
        ttsRate: ttsRate ?? this.ttsRate,
        ttsPitch: ttsPitch ?? this.ttsPitch,
        clock24h: clock24h ?? this.clock24h,
        compactChats: compactChats ?? this.compactChats,
        bigEmoji: bigEmoji ?? this.bigEmoji,
        hideListPreview: hideListPreview ?? this.hideListPreview,
        inAppSounds: inAppSounds ?? this.inAppSounds,
        hapticFeedback: hapticFeedback ?? this.hapticFeedback,
        appLockEnabled: appLockEnabled ?? this.appLockEnabled,
        appLockPinHash: appLockPinHash ?? this.appLockPinHash,
        appLockGraceSeconds: appLockGraceSeconds ?? this.appLockGraceSeconds,
        chatSort: chatSort ?? this.chatSort,
        accentBubbles: accentBubbles ?? this.accentBubbles,
        messageFormatting: messageFormatting ?? this.messageFormatting,
        wallpaperDim: wallpaperDim ?? this.wallpaperDim,
        swipeRightAction: swipeRightAction ?? this.swipeRightAction,
        startTab: startTab ?? this.startTab,
        incognitoKeyboard: incognitoKeyboard ?? this.incognitoKeyboard,
        confirmBeforeDelete: confirmBeforeDelete ?? this.confirmBeforeDelete,
        quickReplies: quickReplies ?? this.quickReplies,
        showContactMood: showContactMood ?? this.showContactMood,
        chatListMoodEmoji: chatListMoodEmoji ?? this.chatListMoodEmoji,
        collectMetrics: collectMetrics ?? this.collectMetrics,
        devOptionsUnlocked: devOptionsUnlocked ?? this.devOptionsUnlocked,
        showPerformanceOverlay:
            showPerformanceOverlay ?? this.showPerformanceOverlay,
      );

  Map<String, dynamic> toJson() => {
        'readReceipts': readReceipts,
        'sendTypingIndicators': sendTypingIndicators,
        'notificationsEnabled': notificationsEnabled,
        'notificationPreview': notificationPreview,
        'notificationVibrate': notificationVibrate,
        'callRingtone': callRingtone,
        'enterToSend': enterToSend,
        'fontScale': fontScale,
        'wallpaper': wallpaper,
        'wallpaperSpec': wallpaperSpec,
        'designId': designId,
        'customColor': customColor,
        'amoledDark': amoledDark,
        'reduceMotion': reduceMotion,
        'boldText': boldText,
        'highContrast': highContrast,
        'bubbleCorners': bubbleCorners,
        'quietHoursEnabled': quietHoursEnabled,
        'quietStart': quietStart,
        'quietEnd': quietEnd,
        'dataSaver': dataSaver,
        'ttsEnabled': ttsEnabled,
        'ttsAutoRead': ttsAutoRead,
        'ttsLanguage': ttsLanguage,
        'ttsRate': ttsRate,
        'ttsPitch': ttsPitch,
        'clock24h': clock24h,
        'compactChats': compactChats,
        'bigEmoji': bigEmoji,
        'hideListPreview': hideListPreview,
        'inAppSounds': inAppSounds,
        'hapticFeedback': hapticFeedback,
        'appLockEnabled': appLockEnabled,
        'appLockPinHash': appLockPinHash,
        'appLockGraceSeconds': appLockGraceSeconds,
        'chatSort': chatSort,
        'accentBubbles': accentBubbles,
        'messageFormatting': messageFormatting,
        'wallpaperDim': wallpaperDim,
        'swipeRightAction': swipeRightAction,
        'startTab': startTab,
        'incognitoKeyboard': incognitoKeyboard,
        'confirmBeforeDelete': confirmBeforeDelete,
        'quickReplies': quickReplies,
        'showContactMood': showContactMood,
        'chatListMoodEmoji': chatListMoodEmoji,
        'collectMetrics': collectMetrics,
        'devOptionsUnlocked': devOptionsUnlocked,
        'showPerformanceOverlay': showPerformanceOverlay,
      };

  factory PingSettings.fromJson(Map<String, dynamic> j) => PingSettings(
        readReceipts: j['readReceipts'] ?? true,
        sendTypingIndicators: j['sendTypingIndicators'] ?? true,
        notificationsEnabled: j['notificationsEnabled'] ?? true,
        notificationPreview: j['notificationPreview'] ?? true,
        notificationVibrate: j['notificationVibrate'] ?? true,
        callRingtone: j['callRingtone'] ?? true,
        enterToSend: j['enterToSend'] ?? false,
        fontScale: (j['fontScale'] as num?)?.toDouble() ?? 1.0,
        wallpaper: j['wallpaper'] ?? 0,
        designId: (j['designId'] as String?) ?? 'ocean',
        customColor: j['customColor'] as int?,
        amoledDark: j['amoledDark'] ?? false,
        reduceMotion: j['reduceMotion'] ?? false,
        boldText: j['boldText'] ?? false,
        highContrast: j['highContrast'] ?? false,
        bubbleCorners: (j['bubbleCorners'] as num?)?.toDouble() ?? 1.0,
        quietHoursEnabled: j['quietHoursEnabled'] ?? false,
        quietStart: (j['quietStart'] as num?)?.toInt() ?? 1320,
        quietEnd: (j['quietEnd'] as num?)?.toInt() ?? 420,
        dataSaver: j['dataSaver'] ?? false,
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
        clock24h: j['clock24h'] ?? true,
        compactChats: j['compactChats'] ?? false,
        bigEmoji: j['bigEmoji'] ?? true,
        hideListPreview: j['hideListPreview'] ?? false,
        inAppSounds: j['inAppSounds'] ?? true,
        hapticFeedback: j['hapticFeedback'] ?? true,
        appLockEnabled: j['appLockEnabled'] ?? false,
        appLockPinHash: (j['appLockPinHash'] as String?) ?? '',
        appLockGraceSeconds: (j['appLockGraceSeconds'] as num?)?.toInt() ?? 0,
        chatSort: (j['chatSort'] as String?) ?? 'recent',
        accentBubbles: j['accentBubbles'] ?? false,
        messageFormatting: j['messageFormatting'] ?? true,
        wallpaperDim:
            ((j['wallpaperDim'] as num?)?.toDouble() ?? 0.0).clamp(0.0, 0.6),
        swipeRightAction: (j['swipeRightAction'] as String?) ?? 'pin',
        startTab: ((j['startTab'] as num?)?.toInt() ?? 0).clamp(0, 2),
        incognitoKeyboard: j['incognitoKeyboard'] ?? false,
        confirmBeforeDelete: j['confirmBeforeDelete'] ?? true,
        quickReplies: (j['quickReplies'] as List?)
                ?.map((e) => e.toString())
                .where((e) => e.trim().isNotEmpty)
                .toList() ??
            kDefaultQuickReplies,
        showContactMood: j['showContactMood'] ?? true,
        chatListMoodEmoji: j['chatListMoodEmoji'] ?? true,
        collectMetrics: j['collectMetrics'] ?? false,
        devOptionsUnlocked: j['devOptionsUnlocked'] ?? false,
        showPerformanceOverlay: j['showPerformanceOverlay'] ?? false,
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

  /// Whether message notifications should currently be silenced because the
  /// local time falls inside the user's quiet-hours window. Handles windows
  /// that wrap past midnight (e.g. 22:00 → 07:00).
  bool isQuietNow([DateTime? now]) {
    if (!quietHoursEnabled) return false;
    final t = now ?? DateTime.now();
    final mins = t.hour * 60 + t.minute;
    if (quietStart == quietEnd) return false; // empty window
    return quietStart < quietEnd
        ? mins >= quietStart && mins < quietEnd
        : mins >= quietStart || mins < quietEnd; // wraps midnight
  }

  /// Format a minutes-after-midnight value as `HH:MM`.
  static String formatMinutes(int minutes) {
    final h = (minutes ~/ 60) % 24;
    final m = minutes % 60;
    return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
  }
}

/// Canned messages a user can fire off from the composer with one tap. Editable
/// in Einstellungen → Chats → Schnellantworten; this is the starter set.
const kDefaultQuickReplies = <String>[
  '👍 Alles klar!',
  'Bin gleich da 🏃',
  'Melde mich später 🙂',
  'Danke dir! 🙏',
  'Kannst du kurz anrufen?',
];

/// What a right-swipe on a chat row does (Einstellungen → Chats). Maps each id
/// to its German label for the picker.
const kSwipeRightActions = <String, String>{
  'pin': 'Anheften',
  'mute': 'Stummschalten',
  'none': 'Aus',
};

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
