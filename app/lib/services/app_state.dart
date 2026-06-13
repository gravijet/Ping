import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme.dart';
import '../models/chat.dart';
import '../models/message.dart';
import '../models/settings.dart';
import '../models/status.dart';
import '../models/user.dart';
import 'api_client.dart';
import 'audio_player_service.dart';
import 'media_service.dart';
import 'local_message_store.dart';
import 'notification_service.dart';
import 'notification_target.dart';
import 'push_service.dart';
import 'socket_service.dart';
import 'starred_store.dart';
import 'tts_service.dart';
import 'update_service.dart';
import 'wallpaper_service.dart';

const _kToken = 'ping_token';
const _kBaseUrl = 'ping_base_url';
const _kThemeMode = 'ping_theme_mode';
const _kSettings = 'ping_settings';
const _kChatWallpapers = 'ping_chat_wallpapers';
const _kPinnedChats = 'ping_pinned_chats';
const _kUpdatePrompted = 'ping_update_prompted_build';
const _kDrafts = 'ping_drafts';

/// Friendly name shown instead of the raw server address by default, so the
/// endpoint isn't advertised in the UI.
const serverLabel = 'Ping Cloud';

/// The default Ping server. The address is kept packed (not a plain literal)
/// so it isn't trivially visible in the sources/binary; override it at build
/// time with `--dart-define=PING_SERVER=https://your-host`.
String _resolveDefaultServer() {
  const override = String.fromEnvironment('PING_SERVER');
  if (override.isNotEmpty) return override;
  // Primary domain (example.invalid). The old example.invalid host
  // keeps serving the same backend, so existing installs keep working.
  const packed = 'aHR0cHM6Ly9waW5nLmJlbmphbWluYmVyZ2VyLmF0';
  try {
    return utf8.decode(base64.decode(packed));
  } catch (_) {
    return '';
  }
}

final String defaultBaseUrl = _resolveDefaultServer();

/// Whether [url] is the built-in default server (so the UI can show the
/// friendly [serverLabel] instead of the raw address).
bool isDefaultServer(String url) =>
    url.trim().replaceAll(RegExp(r'/$'), '') ==
    defaultBaseUrl.replaceAll(RegExp(r'/$'), '');

enum AuthStatus { unknown, signedOut, signedIn }

/// The single source of truth for the whole app. Screens read from it and call
/// its methods; it talks to the REST API and the socket and notifies listeners.
class AppState extends ChangeNotifier {
  late ApiClient _api;
  late SocketService _socket;
  final NotificationService notifications = NotificationService();
  final PushService push = PushService();
  final WallpaperService wallpapers = WallpaperService();
  final UpdateService updater = UpdateService();
  String? _pushToken;

  /// The newest published build, when it's newer than the installed one. Drives
  /// the update banner / settings hint. Null when up to date or unknown.
  UpdateInfo? availableUpdate;

  /// True when a freshly-detected update hasn't been shown to the user yet, so
  /// the home screen can pop the install sheet once (per version) automatically.
  bool _updateAutoPrompt = false;
  bool get updateAutoPromptPending => _updateAutoPrompt;

  /// Routes a tapped notification to its destination (a chat or a named screen).
  /// Set by the home screen once its Navigator is ready; until then targets are
  /// stashed in [_pendingTarget] (e.g. a cold launch from a notification).
  void Function(NotificationTarget target)? onOpenTarget;
  NotificationTarget? _pendingTarget;

  /// Per-chat wallpaper overrides (chatId → encoded WallpaperSpec). When a chat
  /// has no entry the global [PingSettings.wallpaperSpec] is used.
  final Map<String, String> _chatWallpapers = {};

  /// Chats whose full history has been loaded into memory this session. Only
  /// these are written back to the on-device cache — so an incoming message for
  /// a not-yet-opened chat can't overwrite its cached history with a stub.
  final Set<String> _loadedChats = {};
  final TtsController tts = TtsController();
  final AudioController audio = AudioController();
  final MediaService media = MediaService();
  final LocalMessageStore localStore = LocalMessageStore();
  final StarredStore starredStore = StarredStore();

  /// Message ids the user has bookmarked (for the star in bubbles + the
  /// "Gespeichert" screen). Hydrated from [starredStore] on launch.
  final Set<String> starredIds = {};

  /// Chats the user has pinned to the top of the list (device-local).
  final Set<String> _pinnedChats = {};

  /// Unsent composer drafts per chat (device-local). The chat list shows a
  /// "Entwurf: …" preview, and reopening the chat restores the text.
  final Map<String, String> _drafts = {};

  AuthStatus status = AuthStatus.unknown;
  PingUser? me;
  String baseUrl = defaultBaseUrl;
  bool socketConnected = false;
  ThemeMode themeMode = ThemeMode.system;
  PingSettings settings = const PingSettings();

  final List<Chat> chats = [];
  final Map<String, List<Message>> _messages = {};
  final Set<String> _online = {};
  final Map<String, Set<String>> _typing = {}; // chatId -> userIds typing
  final Map<String, PingUser> _userCache = {};

  // Status ("stories")
  final List<PingStatus> statusMine = [];
  final List<StatusGroup> statusOthers = [];

  // Blocking
  final Set<String> blockedIds = {};

  /// Called when the server pushes an admin announcement (title, body, optional
  /// deep-link route the "Öffnen" action navigates to).
  void Function(String title, String body, String? route)? onAnnouncement;

  /// Called when the server forces this session to end (account disabled or
  /// deleted by an admin). The UI shows the reason and returns to login.
  void Function(String reason)? onForcedLogout;

  int get statusUnseen => statusOthers.where((g) => g.hasUnseen).length;
  bool isBlocked(String userId) => blockedIds.contains(userId);
  bool get isAdmin => me?.isAdmin ?? false;

  String? _activeChatId; // chat currently open on screen

  List<Message> messagesFor(String chatId) => _messages[chatId] ?? const [];
  bool isOnline(String userId) => _online.contains(userId);
  Set<String> typingIn(String chatId) => _typing[chatId] ?? const {};
  PingUser? cachedUser(String id) => _userCache[id];

  int get totalUnread =>
      chats.fold(0, (sum, c) => sum + (c.muted ? 0 : c.unread));

  ApiClient get api => _api;
  SocketService get socket => _socket;

  /// Auth headers for direct image requests (avatars are auth-gated).
  Map<String, String> get authHeaders =>
      {if (_api.token != null) 'Authorization': 'Bearer ${_api.token}'};

  /// URL of a user's uploaded avatar, or null if they don't have one. The
  /// version query busts the cache whenever the picture changes.
  String? avatarUrl(PingUser? user) {
    if (user == null || !user.hasAvatar) return null;
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return '$root/api/users/${user.id}/avatar?v=${user.avatarVersion}';
  }

  /// URL of a group's uploaded picture, or null if it has none.
  String? groupAvatarUrl(Chat chat) {
    if (!chat.isGroup || !chat.hasAvatar) return null;
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return '$root/api/chats/${chat.id}/avatar?v=${chat.avatarVersion}';
  }

  /// Resolve a server-relative attachment path (e.g. `/api/uploads/<id>`) to a
  /// full URL against the current server.
  String mediaUrl(String relative) {
    if (relative.startsWith('http')) return relative;
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return '$root$relative';
  }

  // ---- Bootstrap -----------------------------------------------------------

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    baseUrl = prefs.getString(_kBaseUrl) ?? defaultBaseUrl;
    final token = prefs.getString(_kToken);
    themeMode = _themeFromString(prefs.getString(_kThemeMode));
    settings = PingSettings.decode(prefs.getString(_kSettings));
    _loadChatWallpapers(prefs);
    _loadPinnedChats(prefs);
    _loadDrafts(prefs);
    starredStore.ids().then((ids) {
      starredIds
        ..clear()
        ..addAll(ids);
      notifyListeners();
    });
    await tts.configure(
      language: settings.ttsLanguage,
      rate: settings.ttsRate,
      pitch: settings.ttsPitch,
    );

    _api = ApiClient(baseUrl: baseUrl, token: token);
    _socket = SocketService(
      onEvent: _onSocketEvent,
      onConnectionChange: (c) {
        socketConnected = c;
        notifyListeners();
      },
    );

    await notifications.init();
    notifications.onTap = dispatchNotificationTarget;
    push.onToken = _onPushToken;
    push.onOpen = dispatchNotificationTarget;
    await push.start(notifications: notifications);
    // If the app was cold-launched by tapping a local notification, route to it
    // once the UI is ready.
    final launch = await notifications.launchTarget();
    if (launch != null) dispatchNotificationTarget(launch);

    if (token != null) {
      try {
        final res = await _api.get('/me');
        me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
        status = AuthStatus.signedIn;
        await _afterSignIn();
      } on ApiException {
        // Token invalid/expired — fall back to the login screen.
        await _clearToken();
        status = AuthStatus.signedOut;
      }
    } else {
      status = AuthStatus.signedOut;
    }
    notifyListeners();
  }

  // ---- Auth ----------------------------------------------------------------

  /// Register a new account: phone, email and password are all required.
  /// [verifyToken] is the server-issued proof from the SMS OTP flow (see
  /// [requestPhoneCode]/[verifyPhoneCode]); [firebaseIdToken] is the legacy
  /// Firebase alternative. Either, or neither (when verification isn't enforced).
  Future<void> register(
      String phone, String email, String password, String displayName,
      {String? verifyToken, String? firebaseIdToken}) async {
    final res = await _api.post('/auth/register', {
      'phone': phone,
      'email': email,
      'password': password,
      'displayName': displayName,
      if (verifyToken != null) 'verifyToken': verifyToken,
      if (firebaseIdToken != null) 'firebaseIdToken': firebaseIdToken,
    });
    await _handleAuthSuccess(res);
  }

  /// Ask the server to text a one-time verification code to [phone]. Returns the
  /// decoded response: `{ expiresIn, devCode?, warning? }`. `devCode` is only
  /// present when the server runs the test ('log') SMS provider. [purpose] is
  /// 'register' (default, number must be free) or 'reset' (password reset, the
  /// number must belong to an existing account).
  Future<Map<String, dynamic>> requestPhoneCode(String phone,
      {String purpose = 'register'}) async {
    final res = await _api.post('/auth/request-code', {
      'phone': phone,
      'purpose': purpose,
    });
    return Map<String, dynamic>.from(res as Map);
  }

  /// Confirm an SMS [code] for [phone]; returns a short-lived verification token
  /// to pass to [register].
  Future<String> verifyPhoneCode(String phone, String code) async {
    final res = await _api.post('/auth/verify-code', {
      'phone': phone,
      'code': code,
    });
    return (res as Map)['verifyToken'] as String;
  }

  /// Log in with email or phone number + password.
  Future<void> login(String loginId, String password) async {
    final res = await _api.post('/auth/login', {
      'login': loginId,
      'password': password,
    });
    await _handleAuthSuccess(res);
  }

  /// Forgot password: set a new password after proving phone ownership via the
  /// SMS code flow ([requestPhoneCode] with purpose 'reset' → [verifyPhoneCode]).
  /// On success the account is signed in right away.
  Future<void> resetPassword(
      String phone, String verifyToken, String password) async {
    final res = await _api.post('/auth/reset-password', {
      'phone': phone,
      'verifyToken': verifyToken,
      'password': password,
    });
    await _handleAuthSuccess(res);
  }

  Future<void> _handleAuthSuccess(dynamic res) async {
    final token = res['token'] as String;
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _api.token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, token);
    status = AuthStatus.signedIn;
    notifyListeners();
    await _afterSignIn();
  }

  Future<void> _afterSignIn() async {
    _socket.connect(baseUrl, _api.token!);
    await notifications.requestPermission();
    await _registerPushToken();
    await loadChats();
    await loadBlocks();
    await loadStatus();
    // Quietly check for a newer app build in the background.
    checkForUpdate();
  }

  // ---- Notification routing ------------------------------------------------

  /// Route a tapped notification to its destination. If the UI isn't ready yet
  /// (cold launch), stash it until the home screen registers [onOpenTarget].
  void dispatchNotificationTarget(NotificationTarget target) {
    final handler = onOpenTarget;
    if (handler != null) {
      handler(target);
    } else {
      _pendingTarget = target;
    }
  }

  /// Consume any notification target queued before the UI was ready.
  NotificationTarget? takePendingTarget() {
    final t = _pendingTarget;
    _pendingTarget = null;
    return t;
  }

  // ---- App lifecycle -------------------------------------------------------

  /// When the app goes to the background we drop the live socket so the server
  /// treats us as offline and delivers new messages via push instead — this is
  /// what makes notifications arrive reliably whether the app is open or not.
  void appPaused() {
    if (status == AuthStatus.signedIn) _socket.disconnect();
  }

  /// Reconnect and refresh when the app returns to the foreground.
  void appResumed() {
    if (status != AuthStatus.signedIn || _api.token == null) return;
    if (!_socket.isConnected) _socket.connect(baseUrl, _api.token!);
    // Best-effort refresh; a transient network error here shouldn't surface.
    loadChats().catchError((_) {});
    loadStatus();
    checkForUpdate();
  }

  // ---- App updates ---------------------------------------------------------

  /// Look for a newer published build. Sets [availableUpdate] when one exists,
  /// and arms a one-time auto-prompt the first time a given version is seen.
  /// Best-effort and silent: failures simply leave the current state untouched.
  Future<void> checkForUpdate() async {
    if (!updater.supported) return;
    final info = await updater.fetch(baseUrl);
    if (info == null) return;
    final newer = await updater.isNewer(info);
    availableUpdate = newer ? info : null;
    if (newer) {
      final prefs = await SharedPreferences.getInstance();
      final prompted = prefs.getString(_kUpdatePrompted);
      _updateAutoPrompt = prompted != info.build;
    } else {
      _updateAutoPrompt = false;
    }
    notifyListeners();
  }

  /// Remember that we've offered the current update, so we don't auto-pop the
  /// install sheet again for the same version.
  Future<void> markUpdatePrompted() async {
    _updateAutoPrompt = false;
    final build = availableUpdate?.build;
    if (build != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kUpdatePrompted, build);
    }
  }

  void dismissUpdate() {
    availableUpdate = null;
    _updateAutoPrompt = false;
    notifyListeners();
  }

  // ---- Push notifications --------------------------------------------------

  void _onPushToken(String token) {
    _pushToken = token;
    _registerPushToken();
  }

  /// Tell the server about this device's FCM token so it can push new messages
  /// and announcements when the app isn't open. No-op until we're signed in.
  Future<void> _registerPushToken() async {
    final t = _pushToken;
    if (t == null || status != AuthStatus.signedIn || _api.token == null) return;
    try {
      await _api.post('/push/token', {'token': t, 'platform': 'android'});
    } catch (_) {
      // Push is best-effort; a failed registration shouldn't block sign-in.
    }
  }

  Future<void> _unregisterPushToken() async {
    final t = _pushToken ?? await push.currentToken();
    if (t == null || _api.token == null) return;
    try {
      await _api.delete('/push/token', {'token': t});
    } catch (_) {
      // Ignore — the token will eventually be pruned server-side if stale.
    }
  }

  Future<void> logout() async {
    await _unregisterPushToken();
    await localStore.clearAll();
    await starredStore.clearAll();
    starredIds.clear();
    _pinnedChats.clear();
    _loadedChats.clear();
    _drafts.clear();
    SharedPreferences.getInstance()
        .then((prefs) => prefs.remove(_kDrafts))
        .catchError((_) => false);
    _socket.disconnect();
    await _clearToken();
    await tts.stop();
    await audio.stop();
    chats.clear();
    _messages.clear();
    _online.clear();
    _typing.clear();
    statusMine.clear();
    statusOthers.clear();
    blockedIds.clear();
    me = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  /// Permanently delete the signed-in account. The server requires the current
  /// password as confirmation; on success the local session is cleared just
  /// like a logout (which drops us back to the login screen).
  Future<void> deleteAccount(String password) async {
    await _api.delete('/me', {'password': password});
    await logout();
  }

  Future<void> _clearToken() async {
    _api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
  }

  // ---- Settings ------------------------------------------------------------

  Future<void> setBaseUrl(String url) async {
    baseUrl = url.trim();
    _api.baseUrl = baseUrl;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, baseUrl);
    // Reconnect the socket against the new host if we're signed in.
    if (status == AuthStatus.signedIn && _api.token != null) {
      _socket.connect(baseUrl, _api.token!);
    }
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kThemeMode, mode.name);
    notifyListeners();
  }

  /// Persist the on-device [PingSettings] and apply anything that takes effect
  /// immediately (e.g. the text-to-speech voice configuration).
  Future<void> updateSettings(PingSettings next) async {
    settings = next;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kSettings, next.encode());
    await tts.configure(
      language: next.ttsLanguage,
      rate: next.ttsRate,
      pitch: next.ttsPitch,
    );
    notifyListeners();
  }

  // ---- Chat wallpapers -----------------------------------------------------

  void _loadChatWallpapers(SharedPreferences prefs) {
    _chatWallpapers.clear();
    final raw = prefs.getString(_kChatWallpapers);
    if (raw == null || raw.isEmpty) return;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      map.forEach((k, v) => _chatWallpapers[k] = v.toString());
    } catch (_) {
      /* corrupt — ignore */
    }
  }

  /// The wallpaper spec in effect for a chat: its own override if set, else the
  /// global one.
  WallpaperSpec wallpaperFor(String chatId) {
    final override = _chatWallpapers[chatId];
    if (override != null) return WallpaperSpec.decode(override);
    return WallpaperSpec.decode(settings.wallpaperSpec);
  }

  bool hasChatWallpaper(String chatId) => _chatWallpapers.containsKey(chatId);

  /// Set (or, with null, clear) a per-chat wallpaper override.
  Future<void> setChatWallpaper(String chatId, WallpaperSpec? spec) async {
    if (spec == null) {
      _chatWallpapers.remove(chatId);
    } else {
      _chatWallpapers[chatId] = spec.encode();
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kChatWallpapers, jsonEncode(_chatWallpapers));
    notifyListeners();
  }

  /// Set the global default wallpaper used by every chat without an override.
  Future<void> setGlobalWallpaper(WallpaperSpec spec) async {
    await updateSettings(settings.copyWith(wallpaperSpec: spec.encode()));
  }

  // ---- Pinned chats --------------------------------------------------------

  void _loadPinnedChats(SharedPreferences prefs) {
    _pinnedChats.clear();
    final raw = prefs.getStringList(_kPinnedChats);
    if (raw != null) _pinnedChats.addAll(raw);
  }

  bool isPinned(String chatId) => _pinnedChats.contains(chatId);

  /// Pin/unpin a chat to the top of the list (kept on this device only).
  Future<void> togglePin(String chatId) async {
    if (!_pinnedChats.remove(chatId)) _pinnedChats.add(chatId);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_kPinnedChats, _pinnedChats.toList());
    _sortChats();
    notifyListeners();
  }

  // ---- Drafts ---------------------------------------------------------------

  void _loadDrafts(SharedPreferences prefs) {
    _drafts.clear();
    final raw = prefs.getString(_kDrafts);
    if (raw == null || raw.isEmpty) return;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      map.forEach((k, v) => _drafts[k] = v.toString());
    } catch (_) {
      /* corrupt — ignore */
    }
  }

  /// The unsent draft for a chat ('' when there is none).
  String draftFor(String chatId) => _drafts[chatId] ?? '';

  /// Remember (or, when empty, forget) the composer draft of a chat.
  Future<void> setDraft(String chatId, String text) async {
    final trimmed = text.trim();
    final unchanged = (_drafts[chatId] ?? '') == (trimmed.isEmpty ? '' : text);
    if (unchanged && trimmed.isEmpty && !_drafts.containsKey(chatId)) return;
    if (trimmed.isEmpty) {
      if (_drafts.remove(chatId) == null) return;
    } else {
      if (_drafts[chatId] == text) return;
      _drafts[chatId] = text;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kDrafts, jsonEncode(_drafts));
    notifyListeners();
  }

  // ---- Starred ("Gespeichert") messages ------------------------------------

  bool isStarred(String messageId) => starredIds.contains(messageId);

  /// Bookmark or un-bookmark a message; the snapshot is stored on-device.
  Future<void> toggleStar(Message message, String chatTitle) async {
    final nowStarred = await starredStore.toggle(message, chatTitle);
    if (nowStarred) {
      starredIds.add(message.id);
    } else {
      starredIds.remove(message.id);
    }
    notifyListeners();
  }

  Future<List<StarredMessage>> starredMessages() => starredStore.load();

  Future<void> unstar(String messageId) async {
    await starredStore.remove(messageId);
    starredIds.remove(messageId);
    notifyListeners();
  }

  // ---- Forwarding ----------------------------------------------------------

  /// Forward a message (text or media) to one or more chats. Media is re-sent by
  /// reference to the same uploaded attachment, so nothing is uploaded twice.
  Future<void> forwardMessage(Message m, List<String> chatIds) async {
    for (final chatId in chatIds) {
      if (m.attachment != null) {
        await sendAttachment(chatId, m.attachment!,
            caption: m.body.trim().isNotEmpty ? m.body.trim() : null);
      } else if (m.body.trim().isNotEmpty) {
        await sendMessage(chatId, m.body);
      }
    }
  }

  // ---- Appearance / design -------------------------------------------------

  /// The active design (preset or custom seed colour) driving the whole theme.
  PingDesign get design =>
      designById(settings.designId, customColor: settings.customColor);

  Future<void> setDesign(PingDesign d) async {
    await updateSettings(settings.copyWith(
      designId: d.id,
      clearCustomColor: d.id != 'custom',
    ));
  }

  /// Pick any colour as a custom design seed.
  Future<void> setCustomColor(Color color) async {
    await updateSettings(settings.copyWith(
      designId: 'custom',
      customColor: color.toARGB32(),
    ));
  }

  // ---- Message storage mode ------------------------------------------------

  bool get localStorageOnly => me?.messageStorage == 'local';

  /// Switch between 'server' (keep history) and 'local' (server purges your sent
  /// messages once everyone has read them; this device keeps the copy).
  Future<void> setMessageStorage(String mode) async {
    final res = await _api.post('/me/message-storage', {'mode': mode});
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  // ---- Backup / export -----------------------------------------------------

  /// Download the full account + chat history from the server and write it to a
  /// JSON file on the device. Returns the saved file path.
  Future<String> exportDataToFile() async {
    final data = await _api.get('/me/export');
    final dir = await getApplicationDocumentsDirectory();
    final ts = DateTime.now()
        .toIso8601String()
        .replaceAll(RegExp(r'[:.]'), '-')
        .split('-')
        .take(5)
        .join('-');
    final file = File('${dir.path}/ping-backup-$ts.json');
    await file.writeAsString(const JsonEncoder.withIndent('  ').convert(data));
    return file.path;
  }

  // ---- Debug chat (*0111) --------------------------------------------------

  /// Every command the hidden debug console understands. Admin-only commands are
  /// hidden (and refused) for non-admin accounts. Drives both the executor and
  /// the live "/" autocomplete in [DebugChatScreen].
  static const List<DebugCommand> _allDebugCommands = [
    DebugCommand('/help', '/help', 'Diese Übersicht'),
    DebugCommand('/me', '/me', 'Dein Konto'),
    DebugCommand('/app', '/app', 'App & Einstellungen'),
    DebugCommand('/server', '/server', 'Server & Verbindung'),
    DebugCommand('/chats', '/chats', 'Chat-Statistik'),
    DebugCommand('/push', '/push', 'Benachrichtigungen & Token'),
    DebugCommand('/ping', '/ping', 'Server-Latenz messen'),
    DebugCommand('/version', '/version', 'App-Version & Update-Status'),
    DebugCommand('/update', '/update', 'Jetzt nach Update suchen'),
    DebugCommand('/storage', '/storage', 'Speicherort der Nachrichten'),
    DebugCommand('/theme', '/theme', 'Aktuelles Design'),
    DebugCommand('/blocked', '/blocked', 'Blockierte Kontakte'),
    DebugCommand('/id', '/id', 'Deine Nutzer-ID'),
    DebugCommand('/time', '/time', 'Geräte- & Serverzeit'),
    DebugCommand('/clearcache', '/clearcache', 'Lokalen Nachrichten-Cache leeren'),
    // ---- Admin-only ----
    DebugCommand('/stats', '/stats', 'Server-Statistik', adminOnly: true),
    DebugCommand('/online', '/online', 'Online-Nutzer zählen', adminOnly: true),
    DebugCommand('/system', '/system', 'Systemzustand des Servers', adminOnly: true),
    DebugCommand('/find', '/find <suche>', 'Nutzer suchen', adminOnly: true),
    DebugCommand('/user', '/user <id>', 'Nutzer-Details', adminOnly: true),
    DebugCommand('/promote', '/promote <id>', 'Zum Admin machen', adminOnly: true),
    DebugCommand('/demote', '/demote <id>', 'Admin entziehen', adminOnly: true),
    DebugCommand('/ban', '/ban <id>', 'Konto sperren', adminOnly: true),
    DebugCommand('/unban', '/unban <id>', 'Konto entsperren', adminOnly: true),
    DebugCommand('/broadcast', '/broadcast <text>', 'Durchsage an alle',
        adminOnly: true),
    DebugCommand('/dm', '/dm <id> <text>', 'Direktnachricht an Nutzer',
        adminOnly: true),
    DebugCommand('/backup', '/backup', 'Server-Backup auslösen', adminOnly: true),
  ];

  /// The commands available to the current account (admin commands filtered out
  /// for non-admins).
  List<DebugCommand> get debugCommands =>
      _allDebugCommands.where((c) => !c.adminOnly || isAdmin).toList();

  /// Handle a command typed into the hidden debug chat (reached by starting a
  /// chat with `*0111`). Returns non-sensitive diagnostic info only — never
  /// tokens, passwords or other secrets. Admins get an extra set of management
  /// commands routed through the same /api/admin endpoints as the portal.
  Future<String> debugCommand(String raw) async {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return 'Tippe /help für die Übersicht.';
    final sp = trimmed.indexOf(' ');
    final cmd = (sp == -1 ? trimmed : trimmed.substring(0, sp)).toLowerCase();
    final args = sp == -1 ? '' : trimmed.substring(sp + 1).trim();

    // Refuse admin commands for non-admins (don't even hint they exist).
    final spec = _allDebugCommands.where((c) => c.name == cmd);
    if (spec.isNotEmpty && spec.first.adminOnly && !isAdmin) {
      return 'Unbekannter Befehl: "$cmd"\nTippe /help für die Übersicht.';
    }

    switch (cmd) {
      case '/help':
      case 'help':
      case '?':
        final lines = debugCommands
            .map((c) => '${c.usage.padRight(18)} — ${c.description}')
            .join('\n');
        return 'Verfügbare Befehle:\n$lines';
      case '/me':
        final m = me;
        if (m == null) return 'Nicht angemeldet.';
        return '👤 Konto\n'
            'Name: ${m.displayName}\n'
            'Telefon: ${m.phone}\n'
            'ID: ${m.id}\n'
            'Admin: ${m.isAdmin ? 'ja' : 'nein'}\n'
            'Profilbild: ${m.hasAvatar ? 'gesetzt' : 'keins'}\n'
            'Info: ${m.about.isEmpty ? '—' : m.about}';
      case '/app':
        final s = settings;
        return '📱 App\n'
            'Design: ${design.name}\n'
            'Hintergrund: ${WallpaperSpec.decode(s.wallpaperSpec).kind.name}\n'
            'Schriftgröße: ${(s.fontScale * 100).round()}%\n'
            'Mit Enter senden: ${s.enterToSend ? 'an' : 'aus'}\n'
            'Benachrichtigungen: ${s.notificationsEnabled ? 'an' : 'aus'}\n'
            'Vorlesen: ${s.ttsEnabled ? 'an' : 'aus'}\n'
            'Eigene Chat-Hintergründe: ${_chatWallpapers.length}';
      case '/server':
        final h = await _api.health();
        return '🌐 Server\n'
            'Adresse: $baseUrl\n'
            'Live-Verbindung: ${socketConnected ? 'verbunden' : 'getrennt'}\n'
            'Erreichbar: ${h != null ? 'ja' : 'nein'}\n'
            'Version: ${h?['version'] ?? 'unbekannt'}';
      case '/chats':
        final groups = chats.where((c) => c.isGroup).length;
        final direct = chats.where((c) => !c.isGroup).length;
        return '💬 Chats\n'
            'Gesamt: ${chats.length}\n'
            'Direkt: $direct\n'
            'Gruppen: $groups\n'
            'Status-Updates anderer: ${statusOthers.length}\n'
            'Eigene Status: ${statusMine.length}\n'
            'Blockiert: ${blockedIds.length}';
      case '/push':
        final token = await push.currentToken();
        return '🔔 Benachrichtigungen\n'
            'Push-Token: ${token != null && token.isNotEmpty ? 'registriert' : 'keins'}\n'
            'Lokale Hinweise: ${settings.notificationsEnabled ? 'an' : 'aus'}';
      case '/ping':
        final sw = Stopwatch()..start();
        final h = await _api.health();
        sw.stop();
        return h != null
            ? '🏓 Server in ${sw.elapsedMilliseconds} ms erreicht.'
            : '🏓 Server nicht erreichbar (${sw.elapsedMilliseconds} ms Timeout).';
      case '/version':
        final cur = await updater.currentVersion();
        final build = await updater.currentBuildNumber();
        await checkForUpdate();
        final up = availableUpdate;
        return '📦 Version\n'
            'Installiert: $cur (Build $build)\n'
            '${up != null ? 'Update verfügbar: ${up.version} (${up.build})' : 'Aktuell — kein Update.'}';
      case '/update':
        if (!updater.supported) return 'Updates gibt es nur in der Android-App.';
        await checkForUpdate();
        final up = availableUpdate;
        return up != null
            ? '⬆️ Update auf ${up.version} verfügbar. Öffne Einstellungen → '
                'App-Update, um es zu installieren.'
            : '✅ Du hast bereits die neueste Version.';
      case '/storage':
        return '🗄️ Nachrichten-Speicher: '
            '${localStorageOnly ? 'nur lokal' : 'Server (Standard)'}';
      case '/theme':
        return '🎨 Design: ${design.name}\n'
            'Modus: ${themeMode.name}';
      case '/blocked':
        return '🚫 Blockierte Kontakte: ${blockedIds.length}';
      case '/id':
        return me == null ? 'Nicht angemeldet.' : 'Deine ID: ${me!.id}';
      case '/time':
        final h = await _api.health();
        return '🕒 Gerät: ${DateTime.now().toLocal()}\n'
            'Server erreichbar: ${h != null ? 'ja' : 'nein'}';
      case '/clearcache':
        await localStore.clearAll();
        for (final id in _loadedChats.toList()) {
          _messages.remove(id);
        }
        _loadedChats.clear();
        notifyListeners();
        return '🧹 Lokaler Nachrichten-Cache geleert.';

      // ---- Admin commands ----
      case '/stats':
        return _adminCall(() async {
          final o = await _api.get('/admin/overview');
          final s = o['stats'] as Map<String, dynamic>;
          return '📊 Server-Statistik\n'
              'Nutzer: ${s['users']} (online ${s['online']}, Admins ${s['admins']})\n'
              'Chats: ${s['chats']} · Gruppen: ${s['groups']}\n'
              'Nachrichten: ${s['messages']} (+${s['messages24h']} / 24h)\n'
              'Neue Nutzer: +${s['newUsers24h']} / 24h\n'
              'Status aktiv: ${s['statuses']} · Push-Geräte: ${s['pushTokens']}\n'
              'Medien: ${s['uploads']}';
        });
      case '/online':
        return _adminCall(() async {
          final o = await _api.get('/admin/overview');
          return '🟢 Online: ${o['stats']['online']} von ${o['stats']['users']} Nutzern';
        });
      case '/system':
        return _adminCall(() async {
          final o = await _api.get('/admin/system');
          final s = o['system'] as Map<String, dynamic>;
          return '🖥️ System\n'
              'Version: ${s['version']} · Node ${s['node']}\n'
              'Uptime: ${s['uptimeSec']}s\n'
              'Speicher: ${s['rssMb']} MB (Heap ${s['heapMb']} MB)\n'
              'RAM frei: ${s['freeMemMb']}/${s['totalMemMb']} MB\n'
              'SMS: ${s['smsProvider']} · Backups: ${o['backups']}';
        });
      case '/find':
        if (args.isEmpty) return 'Nutzung: /find <name | nummer | e-mail>';
        return _adminCall(() async {
          final res = await _api.get('/admin/users', {'q': args});
          final users = (res['users'] as List).take(10).toList();
          if (users.isEmpty) return 'Keine Treffer für „$args".';
          final lines = users
              .map((u) =>
                  '• ${u['displayName']} ${u['disabled'] == true ? '⛔' : ''}${u['isAdmin'] == true ? '🛡️' : ''}\n'
                  '  ${u['phone']} · ${u['id']}')
              .join('\n');
          return '🔎 ${users.length} Treffer:\n$lines';
        });
      case '/user':
        if (args.isEmpty) return 'Nutzung: /user <id>';
        return _adminCall(() async {
          final res = await _api.get('/admin/users/$args');
          final u = res['user'] as Map<String, dynamic>;
          final a = (res['activity'] as Map?) ?? {};
          return '👤 ${u['displayName']}\n'
              'ID: ${u['id']}\n'
              'Telefon: ${u['phone']} · ${u['email']}\n'
              'Admin: ${u['isAdmin'] == true ? 'ja' : 'nein'} · '
              'Gesperrt: ${u['disabled'] == true ? 'ja' : 'nein'} · '
              'Online: ${u['online'] == true ? 'ja' : 'nein'}\n'
              'Nachrichten: ${a['messages'] ?? '–'} · Chats: ${a['chats'] ?? '–'}';
        });
      case '/promote':
      case '/demote':
        if (args.isEmpty) return 'Nutzung: $cmd <id>';
        return _adminCall(() async {
          await _api.patch('/admin/users/$args', {'isAdmin': cmd == '/promote'});
          return cmd == '/promote'
              ? '🛡️ Nutzer ist jetzt Admin.'
              : 'Admin-Rechte entzogen.';
        });
      case '/ban':
      case '/unban':
        if (args.isEmpty) return 'Nutzung: $cmd <id>';
        return _adminCall(() async {
          await _api.patch('/admin/users/$args', {'disabled': cmd == '/ban'});
          return cmd == '/ban' ? '⛔ Konto gesperrt.' : '✅ Konto entsperrt.';
        });
      case '/broadcast':
        if (args.isEmpty) return 'Nutzung: /broadcast <text>';
        return _adminCall(() async {
          final res = await _api.post('/admin/broadcast', {'body': args});
          return '📣 Gesendet — ${res['delivered']} live, ${res['pushed']} Push.';
        });
      case '/dm':
        final dmSp = args.indexOf(' ');
        if (dmSp == -1) return 'Nutzung: /dm <id> <text>';
        final targetId = args.substring(0, dmSp);
        final text = args.substring(dmSp + 1).trim();
        if (text.isEmpty) return 'Nutzung: /dm <id> <text>';
        return _adminCall(() async {
          final res =
              await _api.post('/admin/users/$targetId/message', {'body': text});
          return '✉️ Nachricht gesendet (${res['pushed']} Push).';
        });
      case '/backup':
        return _adminCall(() async {
          final res = await _api.post('/admin/backups');
          return res['ok'] == true
              ? '💾 Backup erstellt: ${res['file']}'
              : 'Backup konnte nicht erstellt werden.';
        });

      default:
        return 'Unbekannter Befehl: "$cmd"\nTippe /help für die Übersicht.';
    }
  }

  /// Run an admin API call for the debug console, turning errors into a friendly
  /// one-line message instead of throwing.
  Future<String> _adminCall(Future<String> Function() fn) async {
    try {
      return await fn();
    } on ApiException catch (e) {
      return '⚠️ ${e.message}';
    } catch (_) {
      return '⚠️ Aktion fehlgeschlagen.';
    }
  }

  Future<void> updateProfile(
      {String? displayName, String? about, String? avatarColor}) async {
    final res = await _api.patch('/me', {
      if (displayName != null) 'displayName': displayName,
      if (about != null) 'about': about,
      if (avatarColor != null) 'avatarColor': avatarColor,
    });
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  /// Add or change the backup email / password used for password login.
  Future<void> setSecurity(
      {String? email, String? password, String? currentPassword}) async {
    final res = await _api.patch('/me/security', {
      if (email != null) 'email': email,
      if (password != null) 'password': password,
      if (currentPassword != null) 'currentPassword': currentPassword,
    });
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  /// Upload a new profile picture (raw image bytes + its content type).
  Future<void> uploadAvatar(List<int> bytes, String contentType) async {
    final res = await _api.postBytes('/me/avatar', bytes, contentType);
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> removeAvatar() async {
    final res = await _api.delete('/me/avatar');
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  // ---- Chats & messages ----------------------------------------------------

  Future<void> loadChats() async {
    final res = await _api.get('/chats');
    chats
      ..clear()
      ..addAll((res['chats'] as List)
          .map((e) => Chat.fromJson(e as Map<String, dynamic>)));
    for (final c in chats) {
      _cacheChatUsers(c);
    }
    _sortChats();
    notifyListeners();
  }

  void _cacheChatUsers(Chat c) {
    if (c.otherUser != null) _userCache[c.otherUser!.id] = c.otherUser!;
    for (final m in c.members) {
      _userCache[m.id] = m;
    }
  }

  Future<List<Message>> loadMessages(String chatId, {bool reset = false}) async {
    final existing = _messages[chatId] ?? [];
    // On a fresh open, show the on-device cache immediately (instant + offline),
    // then reconcile with the server below.
    if (reset && existing.isEmpty) {
      final cached = await localStore.load(chatId);
      if (cached.isNotEmpty) {
        _messages[chatId] = cached;
        notifyListeners();
      }
    }
    final before =
        (!reset && existing.isNotEmpty) ? existing.first.createdAt : null;
    final res = await _api.get('/chats/$chatId/messages', {
      if (before != null) 'before': before,
      'limit': 40,
    });
    final fetched = (res['messages'] as List)
        .map((e) => Message.fromJson(e as Map<String, dynamic>))
        .toList();
    if (reset) {
      // Merge with the local cache so messages the server has already purged
      // (in "nur lokal" storage mode) still show from this device's copy.
      _messages[chatId] = _mergeMessages(fetched, await localStore.load(chatId));
    } else {
      _messages[chatId] = _mergeMessages([...fetched, ...existing], const []);
    }
    _loadedChats.add(chatId);
    _persistLocal(chatId);
    notifyListeners();
    return fetched;
  }

  /// Combine message lists, de-duped by id (server copy wins) and sorted oldest
  /// first. Expired disappearing messages (e.g. stale entries from the local
  /// cache) are dropped.
  List<Message> _mergeMessages(List<Message> primary, List<Message> extra) {
    final byId = <String, Message>{};
    for (final m in primary) {
      byId[m.id] = m;
    }
    for (final m in extra) {
      byId.putIfAbsent(m.id, () => m);
    }
    final all = byId.values.where((m) => !m.isExpired).toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return all;
  }

  void _persistLocal(String chatId) {
    // Only persist chats we've fully loaded, so a stray incoming message for a
    // not-yet-opened chat can't overwrite its cached history with a stub.
    if (!_loadedChats.contains(chatId)) return;
    final list = _messages[chatId];
    if (list != null) localStore.save(chatId, list);
  }

  /// Optimistically append the message, then reconcile with the server.
  Future<void> sendMessage(String chatId, String body, {String? replyTo}) async {
    final temp = Message(
      id: 'tmp-${DateTime.now().microsecondsSinceEpoch}',
      chatId: chatId,
      senderId: me?.id,
      type: 'text',
      body: body,
      replyTo: replyTo,
      createdAt: DateTime.now().millisecondsSinceEpoch,
      status: MessageStatus.sending,
    );
    _appendMessage(temp);
    notifyListeners();

    try {
      final res = await _api.post('/chats/$chatId/messages', {
        'body': body,
        if (replyTo != null) 'replyTo': replyTo,
      });
      final real = Message.fromJson(res['message'] as Map<String, dynamic>);
      final list = _messages[chatId]!;
      // Drop the optimistic bubble and add the real one — unless the socket
      // already delivered it to us first (the server echoes our own messages).
      list.removeWhere((m) => m.id == temp.id);
      if (!list.any((m) => m.id == real.id)) list.add(real);
      _bumpChat(chatId, real);
      notifyListeners();
    } on ApiException {
      // Mark the optimistic bubble as failed so the user can retry.
      final list = _messages[chatId]!;
      final i = list.indexWhere((m) => m.id == temp.id);
      if (i != -1) list[i] = temp.copyWith(status: MessageStatus.failed);
      notifyListeners();
      rethrow;
    }
  }

  /// Upload raw bytes and return the resulting [Attachment] descriptor.
  Future<Attachment> uploadAttachment(
    List<int> bytes,
    String contentType, {
    String? filename,
    String? kind,
    int? width,
    int? height,
    int? durationMs,
  }) async {
    final res =
        await _api.postBytes('/uploads', bytes, contentType, filename: filename);
    final up = res['upload'] as Map<String, dynamic>;
    return Attachment(
      kind: kind ?? (up['kind'] as String? ?? 'file'),
      url: up['url'] as String,
      mime: up['mime'] as String?,
      name: (up['name'] as String?) ?? filename,
      size: up['size'] as int?,
      width: width,
      height: height,
      durationMs: durationMs,
    );
  }

  /// Send a media message (optimistic, like [sendMessage]).
  Future<void> sendAttachment(
    String chatId,
    Attachment att, {
    String? caption,
    String? replyTo,
  }) async {
    final temp = Message(
      id: 'tmp-${DateTime.now().microsecondsSinceEpoch}',
      chatId: chatId,
      senderId: me?.id,
      type: att.kind,
      body: caption?.trim() ?? '',
      attachment: att,
      replyTo: replyTo,
      createdAt: DateTime.now().millisecondsSinceEpoch,
      status: MessageStatus.sending,
    );
    _appendMessage(temp);
    notifyListeners();
    try {
      final res = await _api.post('/chats/$chatId/messages', {
        'type': att.kind,
        if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
        'attachment': att.toJson(),
        if (replyTo != null) 'replyTo': replyTo,
      });
      final real = Message.fromJson(res['message'] as Map<String, dynamic>);
      final list = _messages[chatId]!;
      list.removeWhere((m) => m.id == temp.id);
      if (!list.any((m) => m.id == real.id)) list.add(real);
      _bumpChat(chatId, real);
      notifyListeners();
    } on ApiException {
      final list = _messages[chatId]!;
      final i = list.indexWhere((m) => m.id == temp.id);
      if (i != -1) list[i] = temp.copyWith(status: MessageStatus.failed);
      notifyListeners();
      rethrow;
    }
  }

  /// Per-recipient delivery/read info for one of my own messages (message info).
  Future<List<MessageReceiptInfo>> messageReceipts(
      String chatId, String messageId) async {
    final res =
        await _api.get('/chats/$chatId/messages/$messageId/receipts');
    return (res['receipts'] as List)
        .map((e) => MessageReceiptInfo.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> editMessage(String chatId, String messageId, String body) async {
    final res =
        await _api.patch('/chats/$chatId/messages/$messageId', {'body': body});
    _replaceMessage(Message.fromJson(res['message'] as Map<String, dynamic>));
    notifyListeners();
  }

  Future<void> deleteMessage(String chatId, String messageId) async {
    final res = await _api.delete('/chats/$chatId/messages/$messageId');
    _replaceMessage(Message.fromJson(res['message'] as Map<String, dynamic>));
    notifyListeners();
  }

  /// Toggle an emoji reaction on a message. Optimistically updates the local
  /// counts; the server also broadcasts a `message-updated` event that
  /// reconciles every device.
  Future<void> toggleReaction(
      String chatId, String messageId, String emoji) async {
    final list = _messages[chatId];
    if (list != null) {
      final i = list.indexWhere((m) => m.id == messageId);
      if (i != -1) {
        final m = list[i];
        final counts = Map<String, int>.from(m.reactions);
        final mine = Set<String>.from(m.myReactions);
        if (mine.contains(emoji)) {
          mine.remove(emoji);
          final n = (counts[emoji] ?? 1) - 1;
          if (n <= 0) {
            counts.remove(emoji);
          } else {
            counts[emoji] = n;
          }
        } else {
          mine.add(emoji);
          counts[emoji] = (counts[emoji] ?? 0) + 1;
        }
        list[i] = m.copyWith(reactions: counts, myReactions: mine);
        notifyListeners();
      }
    }
    try {
      await _api.post('/chats/$chatId/messages/$messageId/reactions', {
        'emoji': emoji,
      });
    } catch (_) {
      // The server broadcast (message-updated) will correct any drift; ignore.
    }
  }

  /// Create a poll in a chat (a message of type 'poll'); everyone can vote.
  Future<void> createPoll(
    String chatId,
    String question,
    List<String> options, {
    bool multi = false,
  }) async {
    final res = await _api.post('/chats/$chatId/polls', {
      'question': question,
      'options': options,
      'multi': multi,
    });
    final msg = Message.fromJson(res['message'] as Map<String, dynamic>);
    _appendMessage(msg);
    _bumpChat(chatId, msg);
    notifyListeners();
  }

  /// Toggle a vote for one poll option. The response carries the fresh counts;
  /// other devices reconcile via the server's message-updated broadcast.
  Future<void> votePoll(String chatId, String messageId, int option) async {
    final res = await _api.post(
        '/chats/$chatId/messages/$messageId/vote', {'option': option});
    _replaceMessage(Message.fromJson(res['message'] as Map<String, dynamic>));
    notifyListeners();
  }

  /// "Für mich löschen": hide a message on this account only. Works on
  /// anyone's messages; the rest of the chat is untouched for everyone else.
  Future<void> hideMessageForMe(String chatId, String messageId) async {
    await _api.post('/chats/$chatId/messages/$messageId/hide');
    _removeMessageLocally(chatId, messageId);
    notifyListeners();
  }

  /// Set the disappearing-messages timer of a chat (0 turns it off). Direct
  /// chats: either side; groups: owner only (the server enforces it).
  Future<void> setChatExpire(String chatId, int seconds) async {
    final res = await _api.post('/chats/$chatId/expire', {'seconds': seconds});
    _upsertChat(Chat.fromJson(res['chat'] as Map<String, dynamic>));
    notifyListeners();
  }

  Future<Chat> openDirectChat(PingUser user) async {
    // Reuse an existing direct chat if we already have one in memory.
    final existing = chats.where((c) =>
        !c.isGroup && c.otherUser?.id == user.id);
    if (existing.isNotEmpty) return existing.first;
    final res = await _api.post('/chats/direct', {'userId': user.id});
    final chat = Chat.fromJson(res['chat'] as Map<String, dynamic>);
    _upsertChat(chat);
    _cacheChatUsers(chat);
    notifyListeners();
    return chat;
  }

  /// Open (or create) a direct chat with whoever owns [phone]. Throws an
  /// [ApiException] with a friendly message if that person isn't on Ping yet.
  Future<Chat> startDirectByPhone(String phone) async {
    final res = await _api.post('/chats/direct', {'phone': phone});
    final chat = Chat.fromJson(res['chat'] as Map<String, dynamic>);
    _upsertChat(chat);
    _cacheChatUsers(chat);
    notifyListeners();
    return chat;
  }

  Future<Chat> createGroup(String name, List<String> memberIds) async {
    final res = await _api.post('/chats/group', {
      'name': name,
      'memberIds': memberIds,
    });
    final chat = Chat.fromJson(res['chat'] as Map<String, dynamic>);
    _upsertChat(chat);
    _cacheChatUsers(chat);
    if (res['firstMessage'] != null) {
      _appendMessage(
          Message.fromJson(res['firstMessage'] as Map<String, dynamic>));
    }
    notifyListeners();
    return chat;
  }

  Future<List<PingUser>> addGroupMembers(
      String chatId, List<String> memberIds) async {
    final res = await _api.post('/chats/$chatId/members', {
      'memberIds': memberIds,
    });
    // Refetch the chat so the member list and title reflect the new people.
    final chatRes = await _api.get('/chats/$chatId');
    final chat = Chat.fromJson(chatRes['chat'] as Map<String, dynamic>);
    _upsertChat(chat);
    _cacheChatUsers(chat);
    notifyListeners();
    return (res['added'] as List)
        .map((e) => PingUser.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> leaveGroup(String chatId) async {
    await _api.post('/chats/$chatId/leave');
    chats.removeWhere((c) => c.id == chatId);
    _messages.remove(chatId);
    notifyListeners();
  }

  /// Rename a group and/or change its description (owner only on the server).
  Future<void> updateGroup(String chatId,
      {String? name, String? description}) async {
    final res = await _api.patch('/chats/$chatId', {
      if (name != null) 'name': name,
      if (description != null) 'description': description,
    });
    _upsertChat(Chat.fromJson(res['chat'] as Map<String, dynamic>));
    notifyListeners();
  }

  /// Upload a new group picture (owner only).
  Future<void> uploadGroupAvatar(
      String chatId, List<int> bytes, String contentType) async {
    final res = await _api.postBytes('/chats/$chatId/avatar', bytes, contentType);
    _upsertChat(Chat.fromJson(res['chat'] as Map<String, dynamic>));
    notifyListeners();
  }

  Future<void> removeGroupAvatar(String chatId) async {
    final res = await _api.delete('/chats/$chatId/avatar');
    _upsertChat(Chat.fromJson(res['chat'] as Map<String, dynamic>));
    notifyListeners();
  }

  /// Remove a member from a group (owner only), then refresh the chat.
  Future<void> removeGroupMember(String chatId, String userId) async {
    await _api.delete('/chats/$chatId/members/$userId');
    final chatRes = await _api.get('/chats/$chatId');
    _upsertChat(Chat.fromJson(chatRes['chat'] as Map<String, dynamic>));
    notifyListeners();
  }

  Future<void> toggleMute(String chatId, bool muted) async {
    await _api.post('/chats/$chatId/mute', {'muted': muted});
    final i = chats.indexWhere((c) => c.id == chatId);
    if (i != -1) chats[i] = chats[i].copyWith(muted: muted);
    notifyListeners();
  }

  /// How many chats are tucked away in the "Archiviert" section.
  int get archivedCount => chats.where((c) => c.archived).length;

  /// Archive/unarchive a chat for this account (per-user; synced server-side
  /// so it stays archived across devices).
  Future<void> toggleArchive(String chatId, bool archived) async {
    await _api.post('/chats/$chatId/archive', {'archived': archived});
    final i = chats.indexWhere((c) => c.id == chatId);
    if (i != -1) chats[i] = chats[i].copyWith(archived: archived);
    notifyListeners();
  }

  /// Search the full message history across every chat (server-side). Returns
  /// the newest matches first.
  Future<List<Message>> searchAllMessages(String query) async {
    final res = await _api.get('/messages/search', {'q': query});
    return (res['messages'] as List)
        .map((e) => Message.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Privacy: whether other people may see when we were last online.
  Future<void> setShowLastSeen(bool show) async {
    final res = await _api.post('/me/privacy', {'showLastSeen': show});
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  /// Look up a single registered user by an exact phone number. Returns null if
  /// nobody on Ping matches. People can only be found by phone — never by email
  /// or name — to protect everyone's privacy.
  Future<PingUser?> lookupUser(String phone) async {
    try {
      final res = await _api.post('/users/lookup', {'phone': phone});
      final parsed = PingUser.fromJson(res['user'] as Map<String, dynamic>);
      _userCache[parsed.id] = parsed;
      return parsed;
    } on ApiException catch (e) {
      if (e.status == 404) return null; // nobody on Ping with that identifier
      rethrow;
    }
  }

  /// Privacy-preserving contact matching: send the phone numbers from the device
  /// address book and get back only those that already have a Ping account.
  /// Nothing is stored server-side; unmatched contacts are discarded. Each match
  /// echoes the number we sent so the UI can show which local contact it is.
  Future<List<ContactMatch>> matchContacts(List<String> phones) async {
    final res = await _api.post('/contacts/match', {'phones': phones});
    final matches = (res['users'] as List)
        .map((e) => ContactMatch.fromJson(e as Map<String, dynamic>))
        .toList();
    for (final m in matches) {
      _userCache[m.user.id] = m.user;
    }
    return matches;
  }

  // ---- Status ("stories") --------------------------------------------------

  Future<void> loadStatus() async {
    try {
      final res = await _api.get('/status');
      statusMine
        ..clear()
        ..addAll((res['mine'] as List)
            .map((e) => PingStatus.fromJson(e as Map<String, dynamic>)));
      statusOthers
        ..clear()
        ..addAll((res['others'] as List)
            .map((e) => StatusGroup.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } on ApiException {
      /* leave the previous list in place */
    }
  }

  Future<void> postTextStatus(String body, String bgColor) async {
    await _api.post('/status', {'type': 'text', 'body': body, 'bgColor': bgColor});
    await loadStatus();
  }

  Future<void> postImageStatus(Attachment att, {String? caption}) async {
    await _api.post('/status', {
      'type': 'image',
      'attachment': att.toJson(),
      if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
    });
    await loadStatus();
  }

  Future<void> postVideoStatus(Attachment att, {String? caption}) async {
    await _api.post('/status', {
      'type': 'video',
      'attachment': att.toJson(),
      if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
    });
    await loadStatus();
  }

  /// Post an official "Ping Team" status that every user sees (admin only).
  /// Supports a coloured text card or an image/video with an optional caption.
  Future<void> postOfficialStatus({
    required String type, // 'text' | 'image' | 'video'
    Attachment? attachment,
    String? body,
    String? bgColor,
  }) async {
    await _api.post('/admin/status', {
      'type': type,
      if (attachment != null) 'attachment': attachment.toJson(),
      if (body != null && body.trim().isNotEmpty) 'body': body.trim(),
      if (bgColor != null) 'bgColor': bgColor,
    });
    await loadStatus();
  }

  Future<void> markStatusViewed(String id) async {
    try {
      await _api.post('/status/$id/view');
    } on ApiException {
      /* a missed view receipt isn't worth surfacing */
    }
  }

  Future<List<StatusViewer>> statusViewers(String id) async {
    final res = await _api.get('/status/$id/viewers');
    return (res['viewers'] as List)
        .map((e) => StatusViewer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> deleteStatus(String id) async {
    await _api.delete('/status/$id');
    await loadStatus();
  }

  // ---- Blocking ------------------------------------------------------------

  Future<void> loadBlocks() async {
    try {
      final res = await _api.get('/blocks');
      blockedIds
        ..clear()
        ..addAll((res['blocked'] as List).cast<String>());
      notifyListeners();
    } on ApiException {
      /* keep whatever we had */
    }
  }

  /// Fetch a public user by id (used e.g. to render the blocked list).
  Future<PingUser?> fetchUser(String id) async {
    final cached = _userCache[id];
    if (cached != null) return cached;
    try {
      final res = await _api.get('/users/$id');
      final u = PingUser.fromJson(res['user'] as Map<String, dynamic>);
      _userCache[u.id] = u;
      return u;
    } on ApiException {
      return null;
    }
  }

  Future<void> blockUser(String userId) async {
    await _api.post('/users/$userId/block');
    blockedIds.add(userId);
    notifyListeners();
  }

  Future<void> unblockUser(String userId) async {
    await _api.post('/users/$userId/unblock');
    blockedIds.remove(userId);
    notifyListeners();
  }

  // ---- Active chat tracking ------------------------------------------------

  void setActiveChat(String? chatId) {
    _activeChatId = chatId;
    if (chatId != null) {
      _socket.markRead(chatId, silent: !settings.readReceipts);
      notifications.cancelForChat(chatId);
      final i = chats.indexWhere((c) => c.id == chatId);
      if (i != -1 && chats[i].unread != 0) {
        chats[i] = chats[i].copyWith(unread: 0);
        notifyListeners();
      }
    }
  }

  // ---- Socket events -------------------------------------------------------

  void _onSocketEvent(String type, Map<String, dynamic> payload) {
    switch (type) {
      case 'ready':
        socketConnected = true;
        final online = (payload['online'] as List?)?.cast<String>() ?? [];
        _online
          ..clear()
          ..addAll(online);
        notifyListeners();
        break;

      case 'presence':
        final userId = payload['userId'] as String;
        final online = payload['online'] as bool;
        if (online) {
          _online.add(userId);
        } else {
          _online.remove(userId);
        }
        // Keep the cached "zuletzt online" fresh so the chat header doesn't
        // show a stale timestamp after someone disconnects.
        final lastSeen = payload['lastSeen'] as int?;
        if (lastSeen != null) {
          final cached = _userCache[userId];
          if (cached != null) {
            _userCache[userId] = cached.copyWith(lastSeen: lastSeen);
          }
          for (var i = 0; i < chats.length; i++) {
            final other = chats[i].otherUser;
            if (other != null && other.id == userId) {
              chats[i] = chats[i]
                  .copyWith(otherUser: other.copyWith(lastSeen: lastSeen));
            }
          }
        }
        notifyListeners();
        break;

      case 'message':
        _onIncomingMessage(
            Message.fromJson(payload['message'] as Map<String, dynamic>));
        break;

      case 'message-updated':
        _replaceMessage(
            Message.fromJson(payload['message'] as Map<String, dynamic>));
        notifyListeners();
        break;

      case 'receipt':
        _applyReceipt(payload);
        break;

      case 'read-self':
        // Another of my own devices read this chat — clear my unread here too,
        // and retire any notification still sitting in the tray for it.
        final chatId = payload['chatId'] as String;
        notifications.cancelForChat(chatId);
        final i = chats.indexWhere((c) => c.id == chatId);
        if (i != -1 && chats[i].unread != 0) {
          chats[i] = chats[i].copyWith(unread: 0);
          notifyListeners();
        }
        break;

      case 'typing':
        _onTyping(payload);
        break;

      case 'chat-created':
        final chat = Chat.fromJson(payload['chat'] as Map<String, dynamic>);
        _upsertChat(chat);
        _cacheChatUsers(chat);
        notifyListeners();
        break;

      case 'chat-removed':
        final chatId = payload['chatId'] as String;
        chats.removeWhere((c) => c.id == chatId);
        _messages.remove(chatId);
        notifyListeners();
        break;

      case 'user-updated':
        final user = PingUser.fromJson(payload['user'] as Map<String, dynamic>);
        _userCache[user.id] = user;
        // Reflect the change in the chat list too (title, avatar, last seen) —
        // otherwise a renamed contact keeps their old name until a full reload.
        for (var i = 0; i < chats.length; i++) {
          final c = chats[i];
          if (!c.isGroup && c.otherUser?.id == user.id) {
            chats[i] = c.copyWith(otherUser: user, title: user.displayName);
          } else if (c.isGroup && c.members.any((m) => m.id == user.id)) {
            chats[i] = c.copyWith(
              members: [
                for (final m in c.members) m.id == user.id ? user : m,
              ],
            );
          }
        }
        notifyListeners();
        break;

      case 'message-purged':
        // A disappearing message ran out — drop it everywhere on this device.
        _removeMessageLocally(
          payload['chatId'] as String,
          payload['messageId'] as String,
        );
        notifyListeners();
        break;

      case 'status-added':
        // A contact posted a status — refresh the Status tab.
        loadStatus();
        break;

      case 'announcement':
        final title = (payload['title'] as String?) ?? 'Ping';
        final body = (payload['body'] as String?) ?? '';
        final route = payload['route'] as String?;
        onAnnouncement?.call(title, body, route);
        if (settings.notificationsEnabled) {
          notifications.showMessage(
            title: title,
            body: body,
            target: NotificationTarget(route: route ?? 'home'),
            announcement: true,
          );
        }
        break;

      case 'self-updated':
        // An admin changed our account — apply it live (name, admin flag, …).
        final updated = PingUser.fromJson(payload['user'] as Map<String, dynamic>);
        me = updated;
        notifyListeners();
        break;

      case 'force-logout':
        // Account disabled or deleted by an admin: end the session immediately.
        final reason = (payload['reason'] as String?) ?? 'force-logout';
        _handleForcedLogout(reason);
        break;
    }
  }

  Future<void> _handleForcedLogout(String reason) async {
    onForcedLogout?.call(reason);
    await logout();
  }

  void _onIncomingMessage(Message msg) {
    // If this is our own message echoed back, retire any still-pending
    // optimistic bubble for it so we don't show it twice (match on the
    // attachment URL for media, otherwise the body text).
    if (msg.senderId == me?.id) {
      _messages[msg.chatId]?.removeWhere((m) =>
          m.id.startsWith('tmp-') &&
          (msg.attachment != null
              ? m.attachment?.url == msg.attachment?.url
              : m.body == msg.body));
    }
    _appendMessage(msg);
    _bumpChat(msg.chatId, msg);

    final isMine = msg.senderId == me?.id;
    final isActive = _activeChatId == msg.chatId;

    if (!isMine && !msg.isSystem) {
      if (isActive) {
        // We're looking at it — mark read (silently if receipts are off).
        _socket.markRead(msg.chatId, silent: !settings.readReceipts);
        _maybeReadAloud(msg);
      } else {
        // Bump unread and raise a notification (unless muted / disabled).
        final i = chats.indexWhere((c) => c.id == msg.chatId);
        if (i != -1) {
          final chat = chats[i];
          chats[i] = chat.copyWith(unread: chat.unread + 1);
          if (!chat.muted && settings.notificationsEnabled) {
            final sender = _userCache[msg.senderId]?.displayName ?? chat.title;
            final title = chat.isGroup ? chat.title : sender;
            final preview =
                settings.notificationPreview ? msg.preview : 'Neue Nachricht';
            final body = chat.isGroup ? '$sender: $preview' : preview;
            notifications.showMessage(
                title: title,
                body: body,
                target: NotificationTarget(chatId: msg.chatId));
          }
        }
        // Tell the server we received it so the sender sees a delivered tick.
        _socket.markDelivered(msg.chatId);
      }
    }
    notifyListeners();
  }

  void _maybeReadAloud(Message msg) {
    if (settings.ttsEnabled &&
        settings.ttsAutoRead &&
        !msg.isSystem &&
        msg.body.trim().isNotEmpty) {
      tts.speak(msg.id, msg.body);
    }
  }

  void _applyReceipt(Map<String, dynamic> payload) {
    final chatId = payload['chatId'] as String;
    final messageId = payload['messageId'] as String;
    final status = statusFromString(payload['status'] as String?);
    final list = _messages[chatId];
    if (list == null) return;
    final i = list.indexWhere((m) => m.id == messageId);
    if (i != -1) {
      list[i] = list[i].copyWith(status: status);
      // Keep the chat-list preview's ticks in sync too.
      final ci = chats.indexWhere((c) => c.id == chatId);
      if (ci != -1 && chats[ci].lastMessage?.id == messageId) {
        chats[ci].lastMessage =
            chats[ci].lastMessage!.copyWith(status: status);
      }
      notifyListeners();
    }
  }

  void _onTyping(Map<String, dynamic> payload) {
    final chatId = payload['chatId'] as String;
    final userId = payload['userId'] as String;
    final typing = payload['typing'] as bool;
    final set = _typing.putIfAbsent(chatId, () => <String>{});
    if (typing) {
      set.add(userId);
    } else {
      set.remove(userId);
    }
    notifyListeners();
  }

  // ---- Helpers -------------------------------------------------------------

  void _appendMessage(Message msg) {
    final list = _messages.putIfAbsent(msg.chatId, () => []);
    if (list.any((m) => m.id == msg.id)) return; // de-dupe
    list.add(msg);
    _persistLocal(msg.chatId);
  }

  /// Drop a message from the in-memory list + on-device cache (hide for me /
  /// disappearing-messages purge). Refreshes the chat-list preview if needed.
  void _removeMessageLocally(String chatId, String messageId) {
    final list = _messages[chatId];
    if (list != null) {
      list.removeWhere((m) => m.id == messageId);
      _persistLocal(chatId);
    }
    final ci = chats.indexWhere((c) => c.id == chatId);
    if (ci != -1 && chats[ci].lastMessage?.id == messageId) {
      final remaining = _messages[chatId];
      chats[ci].lastMessage =
          (remaining != null && remaining.isNotEmpty) ? remaining.last : null;
    }
  }

  void _replaceMessage(Message msg) {
    final list = _messages[msg.chatId];
    if (list == null) return;
    final i = list.indexWhere((m) => m.id == msg.id);
    if (i != -1) list[i] = msg;
    final ci = chats.indexWhere((c) => c.id == msg.chatId);
    if (ci != -1 && chats[ci].lastMessage?.id == msg.id) {
      chats[ci].lastMessage = msg;
    }
    _persistLocal(msg.chatId);
  }

  void _bumpChat(String chatId, Message msg) {
    final i = chats.indexWhere((c) => c.id == chatId);
    if (i != -1) {
      chats[i] = chats[i].copyWith(lastMessage: msg, updatedAt: msg.createdAt);
    }
    _sortChats();
  }

  void _upsertChat(Chat chat) {
    final i = chats.indexWhere((c) => c.id == chat.id);
    if (i != -1) {
      chats[i] = chat;
    } else {
      chats.add(chat);
    }
    _sortChats();
  }

  void _sortChats() {
    chats.sort((a, b) {
      // The "note to self" chat sits at the very top.
      if (a.self != b.self) return a.self ? -1 : 1;
      // Then pinned chats, above everything else.
      final ap = isPinned(a.id);
      final bp = isPinned(b.id);
      if (ap != bp) return ap ? -1 : 1;
      final at = a.lastMessage?.createdAt ?? a.updatedAt;
      final bt = b.lastMessage?.createdAt ?? b.updatedAt;
      return bt.compareTo(at);
    });
  }

  /// Open (or create) the "note to self" chat — a direct chat with yourself.
  Future<Chat> openSelfChat() async {
    final existing = chats.where((c) => c.self);
    if (existing.isNotEmpty) return existing.first;
    final res = await _api.post('/chats/direct', {'userId': me!.id});
    final chat = Chat.fromJson(res['chat'] as Map<String, dynamic>);
    _upsertChat(chat);
    _cacheChatUsers(chat);
    notifyListeners();
    return chat;
  }

  ThemeMode _themeFromString(String? s) {
    switch (s) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  @override
  void dispose() {
    _socket.disconnect();
    _api.close();
    tts.dispose();
    audio.dispose();
    super.dispose();
  }
}

/// A command understood by the hidden debug console (`*0111`). Used both to
/// execute the command and to power the live "/" autocomplete.
class DebugCommand {
  final String name; // canonical command, e.g. '/broadcast'
  final String usage; // usage hint, e.g. '/broadcast <text>'
  final String description; // one-line help
  final bool adminOnly;

  const DebugCommand(this.name, this.usage, this.description,
      {this.adminOnly = false});
}
