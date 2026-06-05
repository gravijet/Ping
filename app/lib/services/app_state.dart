import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../models/settings.dart';
import '../models/status.dart';
import '../models/user.dart';
import 'api_client.dart';
import 'audio_player_service.dart';
import 'media_service.dart';
import 'notification_service.dart';
import 'socket_service.dart';
import 'tts_service.dart';

const _kToken = 'ping_token';
const _kBaseUrl = 'ping_base_url';
const _kThemeMode = 'ping_theme_mode';
const _kSettings = 'ping_settings';

/// Friendly name shown instead of the raw server address by default, so the
/// endpoint isn't advertised in the UI.
const serverLabel = 'Ping Cloud';

/// The default Ping server. The address is kept packed (not a plain literal)
/// so it isn't trivially visible in the sources/binary; override it at build
/// time with `--dart-define=PING_SERVER=https://your-host`.
String _resolveDefaultServer() {
  const override = String.fromEnvironment('PING_SERVER');
  if (override.isNotEmpty) return override;
  const packed = 'aHR0cDovLzQ1LjE0MS4xMTYuMTU6NjEzMzc=';
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
  final TtsController tts = TtsController();
  final AudioController audio = AudioController();
  final MediaService media = MediaService();

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

  /// Called when the server pushes an admin announcement (title, body).
  void Function(String title, String body)? onAnnouncement;

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

  /// Register a new account: phone, email and password are all required (no
  /// verification step).
  Future<void> register(
      String phone, String email, String password, String displayName) async {
    final res = await _api.post('/auth/register', {
      'phone': phone,
      'email': email,
      'password': password,
      'displayName': displayName,
    });
    await _handleAuthSuccess(res);
  }

  /// Log in with email or phone number + password.
  Future<void> login(String loginId, String password) async {
    final res = await _api.post('/auth/login', {
      'login': loginId,
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
    await loadChats();
    await loadBlocks();
    await loadStatus();
  }

  Future<void> logout() async {
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
      _messages[chatId] = fetched;
    } else {
      _messages[chatId] = [...fetched, ...existing];
    }
    notifyListeners();
    return fetched;
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

  Future<void> toggleMute(String chatId, bool muted) async {
    await _api.post('/chats/$chatId/mute', {'muted': muted});
    final i = chats.indexWhere((c) => c.id == chatId);
    if (i != -1) chats[i] = chats[i].copyWith(muted: muted);
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
        // Another of my own devices read this chat — clear my unread here too.
        final chatId = payload['chatId'] as String;
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
        notifyListeners();
        break;

      case 'status-added':
        // A contact posted a status — refresh the Status tab.
        loadStatus();
        break;

      case 'announcement':
        final title = (payload['title'] as String?) ?? 'Ping';
        final body = (payload['body'] as String?) ?? '';
        onAnnouncement?.call(title, body);
        if (settings.notificationsEnabled) {
          notifications.showMessage(
              chatId: '__broadcast__', title: title, body: body);
        }
        break;
    }
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
                chatId: msg.chatId, title: title, body: body);
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
      final at = a.lastMessage?.createdAt ?? a.updatedAt;
      final bt = b.lastMessage?.createdAt ?? b.updatedAt;
      return bt.compareTo(at);
    });
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
