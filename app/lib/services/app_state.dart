import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme.dart';
import '../models/call.dart';
import '../models/chat.dart';
import '../models/chat_folder.dart';
import '../models/message.dart';
import '../models/reminder.dart';
import '../models/remote_config.dart';
import '../models/scheduled_message.dart';
import '../models/settings.dart';
import '../models/status.dart';
import '../models/user.dart';
import '../utils/chat_sort.dart';
import '../utils/format.dart';
import 'api_client.dart';
import 'app_lock_service.dart';
import 'audio_player_service.dart';
import 'call_service.dart';
import 'chat_cache_store.dart';
import 'crash_service.dart';
import 'device_info_service.dart';
import 'feedback_service.dart';
import 'link_preview_service.dart';
import 'media_service.dart';
import 'metrics_service.dart';
import 'local_message_store.dart';
import 'outbox_store.dart';
import 'launcher_service.dart';
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
const _kFavoriteChats = 'ping_favorite_chats';
const _kUpdatePrompted = 'ping_update_prompted_build';
const _kLastSeenVersion = 'ping_last_seen_version';
const _kDrafts = 'ping_drafts';
const _kMe = 'ping_me'; // cached identity for offline cold-start
const _kRemoteConfig = 'ping_remote_config'; // cached server-driven config
const _kCallsSeen = 'ping_calls_seen_at'; // newest call timestamp marked as seen

/// Friendly name shown instead of the raw server address by default, so the
/// endpoint isn't advertised in the UI.
const serverLabel = 'Ping Cloud';

/// The default Ping server. The address is kept packed (not a plain literal)
/// so it isn't trivially visible in the sources/binary; override it at build
/// time with `--dart-define=PING_SERVER=https://your-host`.
String _resolveDefaultServer() {
  const override = String.fromEnvironment('PING_SERVER');
  if (override.isNotEmpty) return override;
  // On the web build the app is served from the same origin as its API and
  // WebSocket (e.g. https://example.invalid), so default to that
  // origin — keeps everything same-origin (no CORS) and lets a self-hosted
  // server "just work" without a build-time --dart-define.
  if (kIsWeb) return Uri.base.origin;
  // Primary domain (example.invalid), packed as base64.
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
  final LauncherService launcher = LauncherService();
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

  /// Set to the running app version when it has just been updated, so the home
  /// screen can show the changelog ("Was ist neu") once. Null otherwise.
  String? _whatsNewVersion;
  String? get whatsNewVersion => _whatsNewVersion;

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

  /// Read-only device diagnostics + native haptics (Android bridge).
  final DeviceInfoService deviceInfo = DeviceInfoService();

  /// Asset-free haptic + sound cues, gated by the user's settings. The native
  /// vibrator (when present) gives crisper, distinct patterns; otherwise it
  /// falls back to the platform's built-in haptic channels.
  late final FeedbackService feedback = FeedbackService(() => settings, deviceInfo);

  /// Opt-in, anonymous, on-device usage counters powering the "Deine Statistik"
  /// screen. Reads the live [PingSettings.collectMetrics] flag on every call, so
  /// every [MetricsService.bump] is a no-op until the user turns it on.
  late final MetricsService metrics =
      MetricsService(() => settings.collectMetrics);
  final LocalMessageStore localStore = LocalMessageStore();
  final StarredStore starredStore = StarredStore();
  final ChatCacheStore chatCache = ChatCacheStore();
  final OutboxStore outboxStore = OutboxStore();

  /// Messages composed while offline, waiting to go out (mirrors [outboxStore]
  /// on disk). Flushed in order the moment the connection returns.
  final List<OutboxEntry> _outbox = [];
  bool _flushing = false;

  /// Best-effort connectivity flag driving the offline banner. True until a
  /// network call fails with a transport error (or the socket drops while in the
  /// foreground); flipped back on the next successful call or socket connect.
  bool online = true;
  bool _paused = false;
  bool _wasOffline = false;

  /// Server-driven runtime config (feature flags, limits, notice, min build).
  /// Hydrated from cache on launch, refreshed from `/config` when online.
  RemoteConfig remoteConfig = RemoteConfig.empty;
  int _runningBuild = 0;

  /// The running app's version name (e.g. `0.26.0`), resolved once at startup.
  /// Empty until [init] reads it; the settings/diagnostics screens fall back to
  /// a sensible default while it's loading.
  String runningVersion = '';

  /// Drives 1:1 WebRTC calls. Built lazily on first access rather than in
  /// [init], because the call overlay (mounted from `MaterialApp.builder`)
  /// reads it on the very first frame — before [init]'s async work has run. A
  /// plain `late` field assigned in [init] threw a LateInitializationError on
  /// that first frame, which surfaced as the "Etwas ist schiefgelaufen" screen
  /// right after a fresh install. The socket it signals through is created in
  /// [init] and only touched lazily (when a call actually happens), so it's
  /// safe for this to exist before the socket does.
  late final CallController callController = CallController(
    sendSignal: (type, payload) => _socket.send(type, payload),
    fetchIce: fetchIceServers,
  )..onLogged = _recordCall;

  /// ICE servers (STUN/TURN) for a call, from `/api/ice`.
  Future<List<Map<String, dynamic>>> fetchIceServers() async {
    final res = await _api.get('/ice');
    return ((res['iceServers'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  /// Whether a remotely-toggled feature is enabled (unknown flags use [fallback]).
  bool feature(String name, {bool fallback = false}) =>
      remoteConfig.flag(name, fallback: fallback);

  /// A server-pushed banner to show app-wide, or null.
  RemoteNotice? get serverNotice => remoteConfig.notice;

  // ---- Calls ---------------------------------------------------------------

  /// Load the call history (newest first).
  Future<void> loadCalls() async {
    try {
      final res = await _api.get('/calls');
      calls
        ..clear()
        ..addAll((res['calls'] as List)
            .map((e) => CallEntry.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } on ApiException {
      /* keep the previous list */
    }
  }

  Future<void> clearCallHistory() async {
    calls.clear();
    notifyListeners();
    try {
      await _api.delete('/calls');
    } on ApiException {
      /* best effort */
    }
  }

  Future<void> deleteCall(String id) async {
    calls.removeWhere((c) => c.id == id);
    notifyListeners();
    try {
      await _api.delete('/calls/$id');
    } on ApiException {
      /* best effort */
    }
  }

  /// Persist a finished call to the server log and reflect it locally. Also
  /// surfaces a "missed call" notification for an unanswered incoming call.
  Future<void> _recordCall(CallLog log) async {
    notifications.cancelIncomingCall();
    if (!log.outgoing && log.outcome == CallOutcome.missed) {
      notifications.showMissedCall(name: log.peer.label);
    }
    try {
      final res = await _api.post('/calls', {
        'peerId': log.peer.id,
        'callId': log.callId,
        'direction': log.directionName,
        'video': log.video,
        'outcome': log.outcomeName,
        'duration': log.duration.inSeconds,
      });
      final entry = CallEntry.fromJson(res['call'] as Map<String, dynamic>);
      calls.removeWhere((c) => c.callId == entry.callId);
      calls.insert(0, entry);
      _userCache[entry.peer.id] = entry.peer;
      notifyListeners();
    } on ApiException {
      /* offline — the next loadCalls() will reconcile */
    }
  }

  /// Start a call to [user] (from the chat header). Loads the history afterwards
  /// so the entry shows up once the call ends.
  Future<void> startCall(PingUser user, {required bool video}) async {
    metrics.bump(MetricKeys.callsStarted);
    await callController.startCall(user, video: video);
  }

  /// A foreground "incoming call" data push arrived. If the live socket hasn't
  /// delivered the WebRTC offer yet, ring via a notification and ask the caller
  /// to (re)send the offer so it connects.
  void _onIncomingCallPush(
      String callId, String callerId, String callerName, bool video) {
    if (callController.currentCallId == callId) return; // already ringing in-app
    notifications.showIncomingCall(
        callId: callId, callerName: callerName, video: video, callerId: callerId);
    if (socketConnected) {
      callController.requestOffer(callId, callerId);
    } else {
      _pendingOfferRequest = (callId, callerId);
    }
  }

  void _onCallCanceledPush(String callId) {
    notifications.cancelIncomingCall();
    if (_pendingOfferRequest?.$1 == callId) _pendingOfferRequest = null;
    if (callController.currentCallId == callId) {
      callController.onRemoteEnd(const {});
    }
  }

  /// Accept/decline from a call notification (foreground action or cold launch).
  void _onCallAction(String callId, String callerId, bool video, bool accept) {
    notifications.cancelIncomingCall();
    final live = callController.currentCallId == callId &&
        callController.state == CallState.incoming;
    if (accept) {
      if (live) {
        callController.acceptCall();
      } else {
        // The offer isn't here yet — remember to auto-accept and pull it in.
        _pendingAcceptCallId = callId;
        if (socketConnected) {
          callController.requestOffer(callId, callerId);
        } else {
          _pendingOfferRequest = (callId, callerId);
        }
      }
    } else {
      if (live) {
        callController.rejectCall();
      } else {
        _pendingDeclineCallId = callId;
        // Tell the caller now if we can, so they stop ringing.
        if (socketConnected && callerId.isNotEmpty) {
          _socket.send('call-reject',
              {'to': callerId, 'callId': callId, 'reason': 'declined'});
        }
      }
    }
  }

  /// True when the server says this build is too old to keep running — the UI
  /// shows a blocking "please update" gate. Only meaningful where in-app updates
  /// exist (Android) and we actually know our build number.
  bool get updateMandatory =>
      updater.supported &&
      _runningBuild > 0 &&
      remoteConfig.minSupportedBuild > _runningBuild;

  /// How many messages are still queued for delivery (shown in the banner).
  int get pendingOutbox => _outbox.length;

  /// Message ids the user has bookmarked (for the star in bubbles + the
  /// "Gespeichert" screen). Hydrated from [starredStore] on launch.
  final Set<String> starredIds = {};

  /// Chats the user has pinned to the top of the list (device-local).
  final Set<String> _pinnedChats = {};

  /// Chats the user has marked as favourites (device-local). Drives the
  /// "Favoriten" quick-filter on the chat list.
  final Set<String> _favoriteChats = {};

  // ---- App lock (local PIN gate) -------------------------------------------
  /// Whether the PIN screen is currently covering the app.
  bool appLocked = false;
  /// Wall-clock millis when the app last went to the background (for auto-lock).
  int? _backgroundedAtMs;
  /// True once the gate has been evaluated at least once after launch, so a
  /// configured lock engages on cold start.
  bool _lockArmed = false;

  /// Unsent composer drafts per chat. Kept device-local for instant restore and
  /// (0.27.0) mirrored to the server so they follow the user across devices.
  final Map<String, String> _drafts = {};

  /// 0.27.0 "Ordnung & Ausdruck": pinned messages per chat (chatId → list,
  /// newest pin first) and the user's chat folders, both synced from the server.
  final Map<String, List<Message>> _pins = {};
  final List<ChatFolder> folders = [];

  /// Per-chat debounce timers for mirroring composer drafts to the server.
  final Map<String, Timer> _draftSyncTimers = {};

  AuthStatus status = AuthStatus.unknown;
  PingUser? me;

  /// Called when [init] throws before it could decide an auth status, so the
  /// app advances to the login screen instead of being stranded on the splash
  /// (a hung bootstrap was a cause of the "stuck after install" report).
  void failBootstrap(Object error) {
    debugPrint('Ping bootstrap failed: $error');
    if (status == AuthStatus.unknown) {
      status = AuthStatus.signedOut;
      notifyListeners();
    }
  }

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

  // Call history (newest first).
  final List<CallEntry> calls = [];
  int _callsSeenAt = 0;
  // Missed calls newer than the last time the user looked at the Anrufe tab.
  int get missedCallCount =>
      calls.where((c) => c.missed && c.createdAt > _callsSeenAt).length;

  /// Mark the call history as seen (clears the tab badge). Called when the user
  /// opens the Anrufe tab.
  Future<void> markCallsSeen() async {
    final newest = calls.isEmpty
        ? DateTime.now().millisecondsSinceEpoch
        : calls.first.createdAt;
    if (newest <= _callsSeenAt) return;
    _callsSeenAt = newest;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_kCallsSeen, _callsSeenAt);
  }

  // A call we were asked to accept/decline from a notification before its
  // WebSocket offer arrived (e.g. accepted from the lock-screen). Resolved when
  // the matching `call-offer` comes in.
  String? _pendingAcceptCallId;
  String? _pendingDeclineCallId;
  // A call whose offer we still need the caller to (re)send once we're online.
  (String callId, String callerId)? _pendingOfferRequest;

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

  /// Session-scoped link-preview fetcher + cache (0.28.0 "Kontext"). Re-bound if
  /// the API client is recreated (e.g. on re-login) so it always uses the live
  /// token.
  LinkPreviewService? _linkPreviews;
  LinkPreviewService get linkPreviews {
    if (_linkPreviews == null || !identical(_linkPreviews!.api, _api)) {
      _linkPreviews = LinkPreviewService(_api);
    }
    return _linkPreviews!;
  }

  /// Every prior version of a message (oldest first) plus the current body, for
  /// the edit-history viewer. Each entry: { body, editedAt?, current? }.
  Future<List<Map<String, dynamic>>> messageEditHistory(
      String chatId, String messageId) async {
    final res = await _api.get('/chats/$chatId/messages/$messageId/edits');
    final versions = ((res as Map)['versions'] as List?) ?? const [];
    return versions
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

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

  /// URL of a user's profile background image, or null if they have none.
  String? bannerUrl(PingUser? user) {
    if (user == null || !user.hasBanner) return null;
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return '$root/api/users/${user.id}/banner?v=${user.bannerVersion}';
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
    TimeFormat.clock24h = settings.clock24h;
    callController.ringtoneEnabled = settings.callRingtone;
    _applyPerformanceSettings();
    // Engage the app lock immediately on a cold start so a configured PIN
    // guards the very first frame (the gate watches [appLocked]).
    if (appLockConfigured) appLocked = true;
    remoteConfig = RemoteConfig.decode(prefs.getString(_kRemoteConfig));
    _callsSeenAt = prefs.getInt(_kCallsSeen) ?? 0;
    if (updater.supported) {
      _runningBuild = await updater.currentBuildNumber();
      try {
        runningVersion = await updater.currentVersion();
      } catch (_) {
        /* version label stays empty; UI falls back to a default */
      }
    }
    // Tag crash reports with the exact running build, and load any opt-in usage
    // metrics from disk before the first action can bump a counter.
    CrashService.instance.version =
        '${runningVersion.isEmpty ? '?' : runningVersion}+$_runningBuild';
    unawaited(metrics.load().then((_) => metrics.bump(MetricKeys.appOpens)));
    _loadChatWallpapers(prefs);
    _loadPinnedChats(prefs);
    _loadFavoriteChats(prefs);
    _loadDrafts(prefs);
    starredStore.ids().then((ids) {
      starredIds
        ..clear()
        ..addAll(ids);
      notifyListeners();
    });
    try {
      await tts
          .configure(
            language: settings.ttsLanguage,
            rate: settings.ttsRate,
            pitch: settings.ttsPitch,
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      /* TTS stays at defaults; not worth blocking startup for */
    }

    _api = ApiClient(baseUrl: baseUrl, token: token);
    _socket = SocketService(
      onEvent: _onSocketEvent,
      onConnectionChange: (c) {
        final was = socketConnected;
        socketConnected = c;
        if (c) {
          online = true;
          // A call we accepted while offline/closed needs the caller to re-send
          // its offer now that we have a live socket again.
          final req = _pendingOfferRequest;
          if (req != null) callController.requestOffer(req.$1, req.$2);
          // Run the heavy catch-up only when genuinely returning from an offline
          // stretch — not on the first connect of a normal sign-in, which loads
          // everything itself.
          if (!was && _wasOffline) _onReconnected();
        } else if (!_paused && status == AuthStatus.signedIn) {
          // Dropped while in the foreground → treat as offline.
          online = false;
          _wasOffline = true;
        }
        notifyListeners();
      },
    );

    try {
      await notifications.init().timeout(const Duration(seconds: 8));
    } catch (_) {
      /* local notifications unavailable; messaging still works */
    }
    notifications.onTap = dispatchNotificationTarget;
    notifications.onCallAction = _onCallAction;
    // Direct reply / mark-read from a message notification while the app is
    // alive in the foreground (the background/terminated case is handled
    // out-of-isolate in notification_service.dart).
    notifications.onReply = (chatId, text) {
      sendMessage(chatId, text);
      _markChatReadLocally(chatId);
    };
    notifications.onMarkRead = _markChatReadLocally;
    push.onToken = _onPushToken;
    push.onOpen = dispatchNotificationTarget;
    push.onIncomingCall = _onIncomingCallPush;
    push.onCallCanceled = _onCallCanceledPush;
    try {
      await push
          .start(notifications: notifications)
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      /* push registration can hang without Play Services — never block boot */
    }
    // Launcher shortcuts (recent chats) + their deep-link routing: a tapped
    // shortcut while the app runs arrives via onLaunchRoute; a cold launch is
    // picked up from consumeLaunchRoute below.
    launcher.onLaunchRoute = (route) {
      final t = NotificationTarget.decode(route);
      if (t != null) dispatchNotificationTarget(t);
    };
    launcher.wire();

    // If the app was cold-launched by tapping a local notification, route to it
    // once the UI is ready.
    final launch = await notifications.launchTarget();
    if (launch != null) dispatchNotificationTarget(launch);
    // …or by a launcher shortcut deep link.
    final launchRoute = await launcher.consumeLaunchRoute();
    if (launchRoute != null) {
      final t = NotificationTarget.decode(launchRoute);
      if (t != null) dispatchNotificationTarget(t);
    }
    // Cold-launched by accepting/declining an incoming call from the lock screen.
    final callLaunch = await notifications.launchCall();
    if (callLaunch != null) {
      _onCallAction(callLaunch.callId, callLaunch.callerId, callLaunch.video,
          callLaunch.accept);
    }

    if (token != null) {
      final cachedMe = prefs.getString(_kMe);
      try {
        final res = await _api.get('/me');
        me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
        _cacheMe();
        status = AuthStatus.signedIn;
        await _afterSignIn();
      } on ApiException catch (e) {
        if (e.status == null && cachedMe != null) {
          // Transport error (offline) but we have a saved session — stay signed
          // in and run from the on-device cache until the connection returns.
          try {
            me = PingUser.fromJson(
                jsonDecode(cachedMe) as Map<String, dynamic>);
            status = AuthStatus.signedIn;
            online = false;
            await _afterSignInOffline();
          } catch (_) {
            await _clearToken();
            status = AuthStatus.signedOut;
          }
        } else {
          // Token invalid/expired (the server actively rejected us) — log out.
          await _clearToken();
          status = AuthStatus.signedOut;
        }
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

  /// Log in with email or phone number + password. When the account has
  /// two-factor auth enabled the server returns a challenge instead of a
  /// session — surfaced as a [TwoFactorRequiredException] for the UI to collect
  /// the code and finish via [loginTwoFactor].
  Future<void> login(String loginId, String password) async {
    final res = await _api.post('/auth/login', {
      'login': loginId,
      'password': password,
    });
    if (res is Map && res['twoFactorRequired'] == true) {
      throw TwoFactorRequiredException(res['challenge'] as String);
    }
    await _handleAuthSuccess(res);
  }

  /// Step 2 of a two-factor login: redeem [challenge] with a 6-digit TOTP
  /// [code] or a [recoveryCode]. Exactly one of the two should be provided.
  Future<void> loginTwoFactor(String challenge,
      {String? code, String? recoveryCode}) async {
    final res = await _api.post('/auth/login/2fa', {
      'challenge': challenge,
      if (code != null && code.isNotEmpty) 'code': code,
      if (recoveryCode != null && recoveryCode.isNotEmpty)
        'recoveryCode': recoveryCode,
    });
    await _handleAuthSuccess(res);
  }

  // ---- Desktop device linking (scan a QR like WhatsApp Web) ----------------

  /// Desktop: start a link. Returns `{ linkId, pollSecret, code, expiresAt }`.
  /// The `code` goes into the QR the signed-in phone scans.
  Future<Map<String, dynamic>> startDeviceLink() async {
    final res = await _api.post('/auth/link/start');
    return Map<String, dynamic>.from(res as Map);
  }

  /// Desktop: poll a pending link. When the phone has approved it, this signs
  /// the desktop in (same path as a normal login) and returns true. Otherwise
  /// returns false and the caller keeps polling. Throws on an expired link.
  Future<bool> pollDeviceLink(String linkId, String pollSecret) async {
    final res = await _api.get('/auth/link/poll', {
      'linkId': linkId,
      'secret': pollSecret,
    });
    final status = (res as Map)['status'];
    if (status == 'approved') {
      await _handleAuthSuccess(res);
      return true;
    }
    if (status == 'expired') {
      throw ApiException('Dieser QR-Code ist abgelaufen.');
    }
    return false;
  }

  /// Phone (signed in): approve a scanned QR code, handing the desktop a session.
  Future<void> approveDeviceLink(String code, {String? deviceLabel}) async {
    await _api.post('/auth/link/approve', {
      'code': code,
      if (deviceLabel != null && deviceLabel.isNotEmpty) 'deviceLabel': deviceLabel,
    });
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
    _cacheMe();
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
    loadCalls();
    loadRemoteConfig();
    // Message reminders sync (best-effort; the screen + nav badge read them).
    loadReminders();
    // Replay anything composed while offline last session, then send it now.
    await _hydrateOutbox();
    _flushOutbox();
    // Quietly check for a newer app build in the background.
    checkForUpdate();
    // If the app was just updated, arm the one-time "what's new" changelog.
    _checkWhatsNew();
    // Send one anonymous, bucketed device snapshot for the fleet dashboard
    // (kill-switchable via the remote `deviceTelemetry` flag). Best-effort.
    _reportDeviceSnapshot();
  }

  /// Fire-and-forget anonymous device-fleet snapshot. Respects the server-side
  /// `deviceTelemetry` flag and never throws (see [DeviceInfoService]).
  void _reportDeviceSnapshot() {
    if (!deviceInfo.supported) return;
    if (!feature('deviceTelemetry', fallback: true)) return;
    deviceInfo.reportSnapshot(baseUrl);
  }

  /// Sign-in path when the server is unreachable at cold-start but we have a
  /// saved session: render cached chats + queued messages and keep trying to
  /// connect. A successful reconnect runs [_onReconnected] to catch everything up.
  Future<void> _afterSignInOffline() async {
    _wasOffline = true;
    final cached = await chatCache.load();
    if (cached.isNotEmpty) {
      chats
        ..clear()
        ..addAll(cached);
      for (final c in chats) {
        _cacheChatUsers(c);
      }
      _sortChats();
    }
    await _hydrateOutbox();
    _socket.connect(baseUrl, _api.token!);
    notifyListeners();
  }

  /// First reconnect after an offline stretch: pull fresh data and push out
  /// anything that queued while we were away.
  void _onReconnected() {
    _wasOffline = false;
    loadChats().catchError((_) {});
    loadStatus();
    loadBlocks().catchError((_) {});
    loadRemoteConfig();
    _registerPushToken();
    checkForUpdate();
    _flushOutbox();
  }

  /// Fetch the server-driven config and cache it. Public + best-effort: a failure
  /// just leaves the previously cached config in place.
  Future<void> loadRemoteConfig() async {
    try {
      final res = await _api.get('/config');
      remoteConfig = RemoteConfig.fromJson(Map<String, dynamic>.from(res as Map));
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kRemoteConfig, remoteConfig.encode());
      notifyListeners();
    } on ApiException {
      /* keep the cached config */
    }
  }

  /// Persist the signed-in identity so an offline cold-start can still show the
  /// user (name, avatar colour, admin flag …) without reaching the server.
  void _cacheMe() {
    final m = me;
    if (m == null) return;
    SharedPreferences.getInstance()
        .then((prefs) => prefs.setString(_kMe, jsonEncode(m.toJson())))
        .catchError((_) => false);
  }

  // ---- Outbox (offline send queue) -----------------------------------------

  /// Re-insert the optimistic bubbles for any still-queued messages so they
  /// reappear (with a clock) after an app restart.
  Future<void> _hydrateOutbox() async {
    final entries = await outboxStore.load();
    _outbox
      ..clear()
      ..addAll(entries);
    for (final e in entries) {
      _appendMessage(_messageFromOutbox(e));
    }
    if (entries.isNotEmpty) notifyListeners();
  }

  Message _messageFromOutbox(OutboxEntry e) => Message(
        id: e.tempId,
        chatId: e.chatId,
        senderId: me?.id,
        type: e.type,
        body: e.body,
        attachment:
            e.attachment != null ? Attachment.fromJson(e.attachment!) : null,
        replyTo: e.replyTo,
        createdAt: e.createdAt,
        status: MessageStatus.sending,
      );

  Future<void> _enqueueOutbox(OutboxEntry e) async {
    _outbox.add(e);
    await outboxStore.save(_outbox);
  }

  /// Send everything queued while offline, oldest first. Stops at the first
  /// transport error (still offline); drops messages the server permanently
  /// refuses and marks their bubble failed.
  Future<void> _flushOutbox() async {
    if (_flushing || _outbox.isEmpty || _api.token == null) return;
    _flushing = true;
    try {
      while (_outbox.isNotEmpty) {
        final e = _outbox.first;
        try {
          final res = await _api.post('/chats/${e.chatId}/messages', {
            if (e.type != 'text') 'type': e.type,
            if (e.body.isNotEmpty) 'body': e.body,
            if (e.attachment != null) 'attachment': e.attachment,
            if (e.replyTo != null) 'replyTo': e.replyTo,
          });
          online = true;
          final real = Message.fromJson(res['message'] as Map<String, dynamic>);
          final list = _messages[e.chatId];
          if (list != null) {
            list.removeWhere((m) => m.id == e.tempId);
            if (!list.any((m) => m.id == real.id)) list.add(real);
          }
          _bumpChat(e.chatId, real);
          _outbox.removeAt(0);
          await outboxStore.save(_outbox);
          notifyListeners();
        } on ApiException catch (err) {
          if (err.status == null) {
            online = false;
            _wasOffline = true;
            break; // still offline — try again on the next reconnect
          }
          // Permanent rejection (e.g. a locked channel): give up on this one so
          // the queue can't get stuck, and surface it as failed.
          final list = _messages[e.chatId];
          if (list != null) {
            final i = list.indexWhere((m) => m.id == e.tempId);
            if (i != -1) {
              list[i] = list[i].copyWith(status: MessageStatus.failed);
            }
          }
          _outbox.removeAt(0);
          await outboxStore.save(_outbox);
          notifyListeners();
        }
      }
    } finally {
      _flushing = false;
    }
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
    _paused = true;
    _backgroundedAtMs = DateTime.now().millisecondsSinceEpoch;
    if (status == AuthStatus.signedIn) _socket.disconnect();
  }

  /// Reconnect and refresh when the app returns to the foreground.
  void appResumed() {
    _paused = false;
    _evaluateAppLock();
    if (status != AuthStatus.signedIn || _api.token == null) return;
    if (!_socket.isConnected) _socket.connect(baseUrl, _api.token!);
    // Best-effort refresh; a transient network error here shouldn't surface.
    loadChats().catchError((_) {});
    loadStatus();
    loadCalls();
    loadRemoteConfig();
    checkForUpdate();
    _flushOutbox();
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

  /// Published changelog entries for [version] (CMS posts carrying that
  /// `version`), newest first. Empty on any error or when none exist.
  Future<List<Map<String, dynamic>>> changelogFor(String version) async {
    try {
      final data = await _api.get('/changelog');
      final posts = (data is Map && data['posts'] is List)
          ? data['posts'] as List
          : const [];
      return posts
          .whereType<Map>()
          .map((p) => p.cast<String, dynamic>())
          .where((p) => (p['version'] ?? '').toString() == version)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Arm the one-time "what's new" sheet when the running version differs from
  /// the last one we recorded (i.e. an update was installed). On a fresh install
  /// we just record the version without showing anything.
  Future<void> _checkWhatsNew() async {
    try {
      final current = await updater.currentVersion();
      final prefs = await SharedPreferences.getInstance();
      final last = prefs.getString(_kLastSeenVersion);
      if (last == null) {
        await prefs.setString(_kLastSeenVersion, current);
        return;
      }
      if (last != current) {
        _whatsNewVersion = current;
        notifyListeners();
      }
    } catch (_) {
      /* ignore */
    }
  }

  /// Clear the pending "what's new" flag and persist the version as seen, so the
  /// changelog isn't shown again for this build.
  Future<void> clearWhatsNew() async {
    final v = _whatsNewVersion;
    _whatsNewVersion = null;
    notifyListeners();
    if (v != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kLastSeenVersion, v);
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
    await chatCache.clear();
    await outboxStore.clear();
    starredIds.clear();
    _pinnedChats.clear();
    _favoriteChats.clear();
    _loadedChats.clear();
    _drafts.clear();
    _outbox.clear();
    online = true;
    _wasOffline = false;
    SharedPreferences.getInstance()
        .then((prefs) async {
          await prefs.remove(_kDrafts);
          await prefs.remove(_kMe);
          return true;
        })
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
    final sortChanged = next.chatSort != settings.chatSort;
    settings = next;
    TimeFormat.clock24h = next.clock24h;
    callController.ringtoneEnabled = next.callRingtone;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kSettings, next.encode());
    _applyPerformanceSettings();
    // Re-order the list immediately when the sort mode changes.
    if (sortChanged) _sortChats();
    await tts.configure(
      language: next.ttsLanguage,
      rate: next.ttsRate,
      pitch: next.ttsPitch,
    );
    notifyListeners();
  }

  // ---- Quick replies --------------------------------------------------------

  /// The user's canned messages, ready to insert from the composer.
  List<String> get quickReplies => settings.quickReplies;

  /// Add a canned reply (trimmed, de-duplicated). No-op for blank text.
  Future<void> addQuickReply(String text) async {
    final t = text.trim();
    if (t.isEmpty || settings.quickReplies.contains(t)) return;
    await updateSettings(
        settings.copyWith(quickReplies: [...settings.quickReplies, t]));
  }

  /// Replace the reply at [index] with [text] (trimmed). No-op for blank text or
  /// an out-of-range index.
  Future<void> editQuickReply(int index, String text) async {
    final t = text.trim();
    if (t.isEmpty || index < 0 || index >= settings.quickReplies.length) return;
    final next = [...settings.quickReplies]..[index] = t;
    await updateSettings(settings.copyWith(quickReplies: next));
  }

  /// Remove the canned reply at [index].
  Future<void> removeQuickReply(int index) async {
    if (index < 0 || index >= settings.quickReplies.length) return;
    final next = [...settings.quickReplies]..removeAt(index);
    await updateSettings(settings.copyWith(quickReplies: next));
  }

  /// Restore the built-in starter set of quick replies.
  Future<void> resetQuickReplies() =>
      updateSettings(settings.copyWith(quickReplies: kDefaultQuickReplies));

  /// Size the in-memory image cache from the current settings. Data-saver mode
  /// keeps a small cache (less RAM, fewer decoded images held); otherwise a
  /// sensible cap below Flutter's 100 MB default still trims memory use.
  void _applyPerformanceSettings() {
    final cache = PaintingBinding.instance.imageCache;
    if (settings.dataSaver) {
      cache.maximumSize = 200;
      cache.maximumSizeBytes = 24 << 20; // 24 MB
    } else {
      cache.maximumSize = 600;
      cache.maximumSizeBytes = 64 << 20; // 64 MB
    }
  }

  /// Drop everything Flutter is holding in the image cache and return how many
  /// bytes were freed — backs the "Cache leeren" action in Speicher & Daten.
  int clearImageCache() {
    final cache = PaintingBinding.instance.imageCache;
    final freed = cache.currentSizeBytes;
    cache.clear();
    cache.clearLiveImages();
    return freed;
  }

  /// Bytes currently held by the in-memory image cache (for the storage screen).
  int get imageCacheBytes => PaintingBinding.instance.imageCache.currentSizeBytes;

  /// Whether a message notification may be shown right now: respects the global
  /// toggle and the quiet-hours window. Admin announcements bypass this.
  bool get messageAlertsAllowed =>
      settings.notificationsEnabled && !settings.isQuietNow();

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

  // ---- Favourite chats ------------------------------------------------------

  void _loadFavoriteChats(SharedPreferences prefs) {
    _favoriteChats.clear();
    final raw = prefs.getStringList(_kFavoriteChats);
    if (raw != null) _favoriteChats.addAll(raw);
  }

  bool isFavorite(String chatId) => _favoriteChats.contains(chatId);

  /// How many chats are currently favourited (drives the filter-chip badge).
  int get favoriteCount =>
      chats.where((c) => _favoriteChats.contains(c.id)).length;

  /// Mark/unmark a chat as a favourite (device-local; powers the quick-filter).
  Future<void> toggleFavorite(String chatId) async {
    if (!_favoriteChats.remove(chatId)) _favoriteChats.add(chatId);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_kFavoriteChats, _favoriteChats.toList());
    notifyListeners();
  }

  // ---- Pinned messages (0.27.0 "Ordnung & Ausdruck") -----------------------

  /// A chat's pinned messages (newest pin first), as last synced.
  List<Message> pinsFor(String chatId) => _pins[chatId] ?? const [];

  /// Fetch a chat's pinned messages from the server (called on chat open).
  Future<void> loadPins(String chatId) async {
    try {
      final res = await _api.get('/chats/$chatId/pins');
      _pins[chatId] = ((res['pins'] as List?) ?? const [])
          .map((e) => Message.fromJson(e as Map<String, dynamic>))
          .toList();
      final i = chats.indexWhere((c) => c.id == chatId);
      if (i != -1) chats[i].pinnedCount = _pins[chatId]!.length;
      notifyListeners();
    } catch (_) {
      /* offline — keep whatever is cached */
    }
  }

  /// Pin or unpin a message. The server echoes `chat-pins-updated` to every
  /// member (handled below); a manual refresh keeps it instant if the socket is
  /// briefly down. Throws [ApiException] (e.g. the per-chat pin limit).
  Future<void> setMessagePinned(Message m, bool pinned) async {
    if (pinned) {
      await _api.post('/chats/${m.chatId}/messages/${m.id}/pin');
    } else {
      await _api.delete('/chats/${m.chatId}/messages/${m.id}/pin');
    }
    await loadPins(m.chatId);
  }

  // ---- Chat folders (0.27.0) -----------------------------------------------

  /// Folders that contain [chatId], for the chat-list folder chips.
  bool chatInFolder(String folderId, String chatId) {
    final f = folders.firstWhere((x) => x.id == folderId,
        orElse: () => const ChatFolder(id: '', name: ''));
    return f.id.isNotEmpty && f.contains(chatId);
  }

  Future<void> loadFolders() async {
    try {
      final res = await _api.get('/me/folders');
      folders
        ..clear()
        ..addAll(((res['folders'] as List?) ?? const [])
            .map((e) => ChatFolder.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } catch (_) {
      /* offline — keep the cached folder list */
    }
  }

  Future<void> createFolder(String name, {String emoji = ''}) async {
    await _api.post('/me/folders', {'name': name, 'emoji': emoji});
    await loadFolders();
  }

  Future<void> renameFolder(String id, String name, {String emoji = ''}) async {
    await _api.patch('/me/folders/$id', {'name': name, 'emoji': emoji});
    await loadFolders();
  }

  Future<void> deleteFolder(String id) async {
    await _api.delete('/me/folders/$id');
    folders.removeWhere((f) => f.id == id);
    notifyListeners();
  }

  /// Replace the set of chats inside a folder (the server drops any the user
  /// isn't a member of).
  Future<void> setFolderChats(String id, List<String> chatIds) async {
    await _api.put('/me/folders/$id/chats', {'chatIds': chatIds});
    await loadFolders();
  }

  // ---- App lock (local PIN gate) -------------------------------------------

  /// Whether an app-lock PIN is configured (the gate is usable).
  bool get appLockConfigured =>
      settings.appLockEnabled && settings.appLockPinHash.isNotEmpty;

  /// Turn the lock on with a fresh PIN. Returns false for an invalid PIN.
  Future<bool> setAppLockPin(String pin, {int? graceSeconds}) async {
    if (!AppLock.isValidPin(pin)) return false;
    await updateSettings(settings.copyWith(
      appLockEnabled: true,
      appLockPinHash: AppLock.hashPin(pin),
      appLockGraceSeconds: graceSeconds ?? settings.appLockGraceSeconds,
    ));
    return true;
  }

  /// Remove the lock entirely (requires the current PIN to be verified by the
  /// caller first).
  Future<void> disableAppLock() async {
    appLocked = false;
    await updateSettings(settings.copyWith(
      appLockEnabled: false,
      appLockPinHash: '',
    ));
  }

  /// Update only the auto-lock grace period.
  Future<void> setAppLockGrace(int seconds) =>
      updateSettings(settings.copyWith(appLockGraceSeconds: seconds));

  /// Engage the lock screen immediately (e.g. from a "lock now" action).
  void lockNow() {
    if (appLockConfigured) {
      appLocked = true;
      notifyListeners();
    }
  }

  /// Try to unlock with [pin]; returns whether it matched.
  bool tryUnlock(String pin) {
    if (AppLock.verify(pin, settings.appLockPinHash)) {
      appLocked = false;
      _backgroundedAtMs = null;
      notifyListeners();
      return true;
    }
    return false;
  }

  /// Decide whether the lock should be engaged given how long the app spent in
  /// the background. Called on resume and once on first foreground after launch.
  void _evaluateAppLock() {
    if (!appLockConfigured) {
      if (appLocked) {
        appLocked = false;
        notifyListeners();
      }
      return;
    }
    // Cold start: always lock. Resume from background: honour the grace period.
    final backgrounded = _backgroundedAtMs == null
        ? const Duration(days: 1)
        : Duration(
            milliseconds:
                DateTime.now().millisecondsSinceEpoch - _backgroundedAtMs!);
    final shouldLock = !_lockArmed ||
        AppLock.shouldLock(
          enabled: settings.appLockEnabled,
          pinHash: settings.appLockPinHash,
          graceSeconds: settings.appLockGraceSeconds,
          backgrounded: backgrounded,
        );
    _lockArmed = true;
    if (shouldLock && !appLocked) {
      appLocked = true;
      notifyListeners();
    }
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
    _syncDraftToServer(chatId, trimmed.isEmpty ? '' : text);
  }

  /// Apply a draft pushed from the server (another device) without echoing it
  /// back — local store + notify only, no PUT.
  void _hydrateDraft(String chatId, String text) {
    if (text.trim().isEmpty) {
      if (_drafts.remove(chatId) == null) return;
    } else {
      if (_drafts[chatId] == text) return;
      _drafts[chatId] = text;
    }
    notifyListeners();
  }

  /// Debounced mirror of a draft to the server (700 ms), so a half-typed message
  /// follows the user across devices. Best-effort — offline keeps it local.
  void _syncDraftToServer(String chatId, String text) {
    _draftSyncTimers[chatId]?.cancel();
    _draftSyncTimers[chatId] = Timer(const Duration(milliseconds: 700), () {
      _api.put('/chats/$chatId/draft', {'text': text}).catchError((_) => null);
    });
  }

  // ---- Starred ("Gespeichert") messages ------------------------------------

  bool isStarred(String messageId) => starredIds.contains(messageId);

  /// Bookmark or un-bookmark a message. The snapshot is stored on-device for the
  /// "Gespeichert" screen and (0.27.0) mirrored to the server so the bookmark
  /// shows up on the web client and the user's other devices.
  Future<void> toggleStar(Message message, String chatTitle) async {
    final nowStarred = await starredStore.toggle(message, chatTitle);
    if (nowStarred) {
      starredIds.add(message.id);
    } else {
      starredIds.remove(message.id);
    }
    notifyListeners();
    // Fire-and-forget server sync (the endpoint just toggles, mirroring us).
    _api
        .post('/chats/${message.chatId}/messages/${message.id}/star')
        .catchError((_) => null);
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
    _cacheMe();
    notifyListeners();
  }

  // ---- Backup / export -----------------------------------------------------

  /// Download the full account + chat history from the server and let the user
  /// save it wherever they like (e.g. Downloads) through the system "save"
  /// dialog. Returns the saved path, or null if the user cancelled.
  ///
  /// Earlier this wrote into the app's private documents directory, which the
  /// user could never reach (and the file:// "open" link was blocked on
  /// Android) — so the backup was effectively undownloadable. The save dialog
  /// (SAF on Android) puts the file somewhere the user actually controls.
  Future<String?> exportDataToDownloads() async {
    final data = await _api.get('/me/export');
    final json = const JsonEncoder.withIndent('  ').convert(data);
    final ts = DateTime.now()
        .toIso8601String()
        .replaceAll(RegExp(r'[:.]'), '-')
        .split('-')
        .take(5)
        .join('-');
    return FilePicker.saveFile(
      dialogTitle: 'Backup speichern',
      fileName: 'ping-backup-$ts.json',
      bytes: Uint8List.fromList(utf8.encode(json)),
    );
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

  Future<void> updateProfile({
    String? displayName,
    String? about,
    String? avatarColor,
    String? accentColor,
    String? pronouns,
    String? birthday,
    String? city,
    List<ProfileLink>? links,
    String? moodEmoji,
    String? moodText,
    int? moodUntil,
    bool clearMoodUntil = false,
  }) async {
    final res = await _api.patch('/me', {
      if (displayName != null) 'displayName': displayName,
      if (about != null) 'about': about,
      if (avatarColor != null) 'avatarColor': avatarColor,
      if (accentColor != null) 'accentColor': accentColor,
      if (pronouns != null) 'pronouns': pronouns,
      if (birthday != null) 'birthday': birthday,
      if (city != null) 'city': city,
      if (links != null) 'links': links.map((l) => l.toJson()).toList(),
      if (moodEmoji != null) 'moodEmoji': moodEmoji,
      if (moodText != null) 'moodText': moodText,
      if (clearMoodUntil)
        'moodUntil': null
      else if (moodUntil != null)
        'moodUntil': moodUntil,
    });
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _cacheMe();
    notifyListeners();
  }

  /// Set or clear the temporary mood/status line (with an optional expiry).
  Future<void> setMood(String emoji, String text, {int? until}) async {
    await updateProfile(
      moodEmoji: emoji,
      moodText: text,
      moodUntil: until,
      clearMoodUntil: until == null,
    );
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
    _cacheMe();
    notifyListeners();
  }

  /// Upload a new profile picture (raw image bytes + its content type).
  Future<void> uploadAvatar(List<int> bytes, String contentType) async {
    final res = await _api.postBytes('/me/avatar', bytes, contentType);
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _cacheMe();
    notifyListeners();
  }

  Future<void> removeAvatar() async {
    final res = await _api.delete('/me/avatar');
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _cacheMe();
    notifyListeners();
  }

  /// Upload a profile background image (raw bytes + content type).
  Future<void> uploadBanner(List<int> bytes, String contentType) async {
    final res = await _api.postBytes('/me/banner', bytes, contentType);
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _cacheMe();
    notifyListeners();
  }

  Future<void> removeBanner() async {
    final res = await _api.delete('/me/banner');
    me = PingUser.fromJson(res['user'] as Map<String, dynamic>);
    _cacheMe();
    notifyListeners();
  }

  // ---- Chats & messages ----------------------------------------------------

  Future<void> loadChats() async {
    try {
      final res = await _api.get('/chats');
      chats
        ..clear()
        ..addAll((res['chats'] as List)
            .map((e) => Chat.fromJson(e as Map<String, dynamic>)));
      for (final c in chats) {
        _cacheChatUsers(c);
        // 0.27.0: adopt the server-synced draft if this device has nothing newer
        // typed locally (the local draft always wins while you're composing).
        if (c.draft.isNotEmpty && (_drafts[c.id] ?? '').isEmpty) {
          _drafts[c.id] = c.draft;
        }
      }
      _sortChats();
      online = true;
      chatCache.save(List<Chat>.from(chats));
      _publishShortcuts();
      notifyListeners();
      // Folders sync alongside the chat list (best-effort, never blocks it).
      loadFolders();
    } on ApiException catch (e) {
      if (e.status == null) {
        // Offline: surface it (banner) and fall back to the cached list when we
        // have nothing loaded yet. Don't throw — callers treat this as a no-op.
        online = false;
        _wasOffline = true;
        if (chats.isEmpty) {
          final cached = await chatCache.load();
          if (cached.isNotEmpty) {
            chats
              ..clear()
              ..addAll(cached);
            for (final c in chats) {
              _cacheChatUsers(c);
            }
            _sortChats();
          }
        }
        notifyListeners();
        return;
      }
      rethrow;
    }
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
    final List<Message> fetched;
    try {
      final res = await _api.get('/chats/$chatId/messages', {
        if (before != null) 'before': before,
        'limit': 40,
      });
      online = true;
      fetched = (res['messages'] as List)
          .map((e) => Message.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException catch (e) {
      if (e.status == null) {
        // Offline: keep showing whatever cache we already loaded above, and
        // report "nothing new" rather than throwing an error at the user.
        online = false;
        _wasOffline = true;
        notifyListeners();
        return const [];
      }
      rethrow;
    }
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

  /// Clear a chat's unread state locally + tell the server, and take down any
  /// lingering notification for it. Used by the notification "Gelesen"/reply
  /// actions so the badge and shade reflect the action immediately.
  void _markChatReadLocally(String chatId) {
    _socket.markRead(chatId);
    final i = chats.indexWhere((c) => c.id == chatId);
    if (i != -1 && chats[i].unread != 0) {
      chats[i] = chats[i].copyWith(unread: 0);
      notifyListeners();
    }
    notifications.cancelForChat(chatId);
  }

  /// Mirror the most relevant recent chats onto the launcher as dynamic
  /// shortcuts (Android). Driven off the already-sorted, non-archived list.
  void _publishShortcuts() {
    final picks = <({String chatId, String label})>[];
    for (final c in chats) {
      if (c.archived || c.title.trim().isEmpty) continue;
      picks.add((chatId: c.id, label: c.title.trim()));
      if (picks.length >= 4) break;
    }
    launcher.setChatShortcuts(picks);
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
    metrics.bump(MetricKeys.messagesSent);

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
      online = true;
      notifyListeners();
    } on ApiException catch (e) {
      if (e.status == null) {
        // Offline: queue it and keep the bubble as "sending" (a clock). It goes
        // out automatically on reconnect — no error is shown to the user.
        online = false;
        _wasOffline = true;
        await _enqueueOutbox(OutboxEntry(
          tempId: temp.id,
          chatId: chatId,
          type: 'text',
          body: body,
          replyTo: replyTo,
          createdAt: temp.createdAt,
        ));
        notifyListeners();
        return;
      }
      // The server rejected it → mark failed so the user can retry.
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
    metrics.bump(MetricKeys.messagesSent);
    if (att.isImage) metrics.bump(MetricKeys.photosSent);
    if (att.isVoice) metrics.bump(MetricKeys.voiceSent);
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

  // ---- Scheduled messages ("send later") ----------------------------------

  final Map<String, List<ScheduledMessage>> _scheduled = {};

  List<ScheduledMessage> scheduledFor(String chatId) =>
      _scheduled[chatId] ?? const [];

  Future<void> loadScheduled(String chatId) async {
    try {
      final res = await _api.get('/chats/$chatId/scheduled');
      _scheduled[chatId] = (res['scheduled'] as List)
          .map((e) => ScheduledMessage.fromJson(e as Map<String, dynamic>))
          .toList();
      notifyListeners();
    } on ApiException {
      /* leave any previously loaded list in place */
    }
  }

  Future<void> scheduleMessage(
    String chatId, {
    required String body,
    String type = 'text',
    Attachment? attachment,
    String? replyTo,
    required int sendAt,
  }) async {
    final res = await _api.post('/chats/$chatId/schedule', {
      if (body.trim().isNotEmpty) 'body': body.trim(),
      if (type != 'text') 'type': type,
      if (attachment != null) 'attachment': attachment.toJson(),
      if (replyTo != null) 'replyTo': replyTo,
      'sendAt': sendAt,
    });
    final s = ScheduledMessage.fromJson(res['scheduled'] as Map<String, dynamic>);
    (_scheduled[chatId] ??= []).add(s);
    _scheduled[chatId]!.sort((a, b) => a.sendAt.compareTo(b.sendAt));
    notifyListeners();
  }

  Future<void> cancelScheduled(String chatId, String id) async {
    await _api.delete('/chats/$chatId/scheduled/$id');
    _scheduled[chatId]?.removeWhere((s) => s.id == id);
    notifyListeners();
  }

  // ---- Message reminders ("Erinnere mich", 0.29.0) ------------------------

  final List<Reminder> _reminders = [];

  /// All reminders: pending first (soonest due), then recently fired.
  List<Reminder> get reminders => List.unmodifiable(_reminders);

  /// Number of reminders still waiting to fire (for a nav badge).
  int get pendingReminderCount => _reminders.where((r) => !r.fired).length;

  Future<void> loadReminders() async {
    try {
      final res = await _api.get('/me/reminders');
      _reminders
        ..clear()
        ..addAll((res['reminders'] as List)
            .map((e) => Reminder.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } on ApiException {
      /* offline: keep whatever we had */
    }
  }

  Future<void> createReminder(
    String chatId,
    String messageId, {
    required int remindAt,
    String note = '',
  }) async {
    final res = await _api.post('/chats/$chatId/messages/$messageId/remind', {
      'remindAt': remindAt,
      if (note.trim().isNotEmpty) 'note': note.trim(),
    });
    _upsertReminder(Reminder.fromJson(res['reminder'] as Map<String, dynamic>));
    notifyListeners();
  }

  Future<void> deleteReminder(String id) async {
    await _api.delete('/me/reminders/$id');
    _reminders.removeWhere((r) => r.id == id);
    notifyListeners();
  }

  void _upsertReminder(Reminder r) {
    final i = _reminders.indexWhere((x) => x.id == r.id);
    if (i >= 0) {
      _reminders[i] = r;
    } else {
      _reminders.insert(0, r);
    }
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

  /// Reply to someone's status: opens (or reuses) a direct chat with the status
  /// owner and sends [text] there — like replying to a story.
  Future<void> replyToStatus(PingUser owner, String text) async {
    final body = text.trim();
    if (body.isEmpty) return;
    final chat = await openDirectChat(owner);
    await sendMessage(chat.id, body);
  }

  // ---- Group invite links (communities) ----

  /// The current invite code for a group, or null if no link is active.
  Future<String?> fetchGroupInvite(String chatId) async {
    final res = await _api.get('/chats/$chatId/invite');
    return res['code'] as String?;
  }

  /// Create or rotate a group's invite link (owner only). Returns the code.
  Future<String> createGroupInvite(String chatId) async {
    final res = await _api.post('/chats/$chatId/invite');
    return res['code'] as String;
  }

  /// Turn off a group's invite link (owner only).
  Future<void> revokeGroupInvite(String chatId) async {
    await _api.delete('/chats/$chatId/invite');
  }

  /// Build the shareable URL for an invite [code] against the current server.
  String inviteUrl(String code) => '${mediaUrl('/join/')}$code';

  /// Join a group via an invite code. Returns the chat (existing or new).
  Future<Chat> joinGroupByCode(String code) async {
    final res = await _api.post('/chats/join', {'code': code.trim()});
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
    _cacheMe();
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
    metrics.bump(MetricKeys.statusPosted);
    await loadStatus();
  }

  Future<void> postImageStatus(Attachment att, {String? caption}) async {
    await _api.post('/status', {
      'type': 'image',
      'attachment': att.toJson(),
      if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
    });
    metrics.bump(MetricKeys.statusPosted);
    await loadStatus();
  }

  Future<void> postVideoStatus(Attachment att, {String? caption}) async {
    await _api.post('/status', {
      'type': 'video',
      'attachment': att.toJson(),
      if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
    });
    metrics.bump(MetricKeys.statusPosted);
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
    _markStatusSeenLocally(id);
    try {
      await _api.post('/status/$id/view');
    } on ApiException {
      /* a missed view receipt isn't worth surfacing */
    }
  }

  /// Flip a just-watched status to "seen" in the in-memory feed so the ring on
  /// the Status tab greys out that segment immediately, before the next reload.
  void _markStatusSeenLocally(String id) {
    for (var gi = 0; gi < statusOthers.length; gi++) {
      final g = statusOthers[gi];
      final ii = g.items.indexWhere((s) => s.id == id);
      if (ii == -1) continue;
      if (g.items[ii].seen) return; // already marked — nothing to do
      final items = List<PingStatus>.from(g.items);
      items[ii] = items[ii].copyWith(seen: true);
      statusOthers[gi] = g.copyWith(
        items: items,
        hasUnseen: items.any((s) => !s.seen),
      );
      notifyListeners();
      return;
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
    final opening = chatId != null && chatId != _activeChatId;
    _activeChatId = chatId;
    if (chatId != null) {
      if (opening) metrics.bump(MetricKeys.chatsOpened);
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

      // 0.27.0 — someone pinned/unpinned a message: refresh the banner + count.
      case 'chat-pins-updated':
        final pinChatId = payload['chatId'] as String;
        _pins[pinChatId] = ((payload['pins'] as List?) ?? const [])
            .map((e) => Message.fromJson(e as Map<String, dynamic>))
            .toList();
        final pci = chats.indexWhere((c) => c.id == pinChatId);
        if (pci != -1) {
          chats[pci].pinnedCount =
              (payload['count'] as int?) ?? _pins[pinChatId]!.length;
        }
        notifyListeners();
        break;

      // A draft I changed on another device — adopt it here.
      case 'draft-updated':
        _hydrateDraft(
            payload['chatId'] as String, (payload['text'] ?? '') as String);
        break;

      // My folder set changed on another device.
      case 'folders-updated':
        folders
          ..clear()
          ..addAll(((payload['folders'] as List?) ?? const [])
              .map((e) => ChatFolder.fromJson(e as Map<String, dynamic>)));
        notifyListeners();
        break;

      // ---- Message reminders (0.29.0) ----
      case 'reminder':
        // A reminder came due. Surface it as a notification (bypasses the
        // snooze tile — the user explicitly asked to be nudged) and refresh
        // the list so the screen shows it as "erledigt".
        final rm = payload['reminder'];
        if (rm is Map<String, dynamic>) {
          final r = Reminder.fromJson(rm);
          _upsertReminder(r);
          if (settings.notificationsEnabled) {
            notifications.showMessage(
              title: '⏰ Erinnerung',
              body: r.chatTitle.isNotEmpty ? '${r.label} · ${r.chatTitle}' : r.label,
              target: NotificationTarget(route: 'home'),
              announcement: true,
            );
          }
          notifyListeners();
        }
        break;

      case 'reminder-created':
        final rm = payload['reminder'];
        if (rm is Map<String, dynamic>) {
          _upsertReminder(Reminder.fromJson(rm));
          notifyListeners();
        }
        break;

      case 'reminder-deleted':
        final rid = payload['id'] as String?;
        if (rid != null) {
          _reminders.removeWhere((r) => r.id == rid);
          notifyListeners();
        }
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
        _cacheMe();
        notifyListeners();
        break;

      case 'force-logout':
        // Account disabled or deleted by an admin: end the session immediately.
        final reason = (payload['reason'] as String?) ?? 'force-logout';
        _handleForcedLogout(reason);
        break;

      // ---- WebRTC call signaling (relayed by the server) ----
      case 'call-offer':
        if (payload['from'] is Map) {
          notifications.cancelIncomingCall();
          final callId = payload['callId']?.toString();
          if (callId != null && _pendingOfferRequest?.$1 == callId) {
            _pendingOfferRequest = null;
          }
          callController.onIncomingOffer(
            PingUser.fromJson(
                (payload['from'] as Map).cast<String, dynamic>()),
            payload,
          );
          // Honour an accept/decline the user already chose from the
          // notification before the offer reached us.
          if (callId != null && _pendingDeclineCallId == callId) {
            _pendingDeclineCallId = null;
            callController.rejectCall();
          } else if (callId != null && _pendingAcceptCallId == callId) {
            _pendingAcceptCallId = null;
            callController.acceptCall();
          }
        }
        break;
      case 'call-answer':
        callController.onRemoteAnswer(payload);
        break;
      case 'call-ice':
        callController.onRemoteIce(payload);
        break;
      case 'call-ready':
        callController.onRemoteReady(payload);
        break;
      case 'call-reject':
        callController.onRemoteReject(payload);
        break;
      case 'call-end':
        callController.onRemoteEnd(payload);
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
        feedback.messageReceived();
        _maybeReadAloud(msg);
      } else {
        // Bump unread and raise a notification (unless muted / disabled).
        final i = chats.indexWhere((c) => c.id == msg.chatId);
        if (i != -1) {
          final chat = chats[i];
          chats[i] = chat.copyWith(unread: chat.unread + 1);
          if (!chat.muted && messageAlertsAllowed) {
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
    final mode = ChatSortId.fromId(settings.chatSort);
    chats.sort((a, b) => compareChats(a, b, mode, isPinned: isPinned));
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
