import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../models/user.dart';
import 'api_client.dart';
import 'notification_service.dart';
import 'socket_service.dart';

const _kToken = 'ping_token';
const _kBaseUrl = 'ping_base_url';
const _kThemeMode = 'ping_theme_mode';

/// The default Ping server. Always pre-filled so the app works out of the box;
/// it can still be changed on the login screen / in settings.
const defaultBaseUrl = 'http://192.0.2.1:61337';

enum AuthStatus { unknown, signedOut, signedIn }

/// The single source of truth for the whole app. Screens read from it and call
/// its methods; it talks to the REST API and the socket and notifies listeners.
class AppState extends ChangeNotifier {
  late ApiClient _api;
  late SocketService _socket;
  final NotificationService notifications = NotificationService();

  AuthStatus status = AuthStatus.unknown;
  PingUser? me;
  String baseUrl = defaultBaseUrl;
  bool socketConnected = false;
  ThemeMode themeMode = ThemeMode.system;

  final List<Chat> chats = [];
  final Map<String, List<Message>> _messages = {};
  final Set<String> _online = {};
  final Map<String, Set<String>> _typing = {}; // chatId -> userIds typing
  final Map<String, PingUser> _userCache = {};

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

  // ---- Bootstrap -----------------------------------------------------------

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    baseUrl = prefs.getString(_kBaseUrl) ?? defaultBaseUrl;
    final token = prefs.getString(_kToken);
    themeMode = _themeFromString(prefs.getString(_kThemeMode));

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
  }

  Future<void> logout() async {
    _socket.disconnect();
    await _clearToken();
    chats.clear();
    _messages.clear();
    _online.clear();
    _typing.clear();
    me = null;
    status = AuthStatus.signedOut;
    notifyListeners();
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
  /// [ApiException] with a friendly message if that number isn't on Ping yet.
  Future<Chat> openDirectChatByPhone(String phone) async {
    final res = await _api.post('/chats/by-phone', {'phone': phone});
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

  Future<List<PingUser>> searchUsers(String query) async {
    final res = await _api.get('/users/search', {'q': query});
    final users = (res['users'] as List)
        .map((e) => PingUser.fromJson(e as Map<String, dynamic>))
        .toList();
    for (final u in users) {
      _userCache[u.id] = u;
    }
    return users;
  }

  // ---- Active chat tracking ------------------------------------------------

  void setActiveChat(String? chatId) {
    _activeChatId = chatId;
    if (chatId != null) {
      _socket.markRead(chatId);
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
    }
  }

  void _onIncomingMessage(Message msg) {
    // If this is our own message echoed back, retire any still-pending
    // optimistic bubble for it so we don't show it twice.
    if (msg.senderId == me?.id) {
      _messages[msg.chatId]
          ?.removeWhere((m) => m.id.startsWith('tmp-') && m.body == msg.body);
    }
    _appendMessage(msg);
    _bumpChat(msg.chatId, msg);

    final isMine = msg.senderId == me?.id;
    final isActive = _activeChatId == msg.chatId;

    if (!isMine && !msg.isSystem) {
      if (isActive) {
        // We're looking at it — immediately mark read and acknowledge.
        _socket.markRead(msg.chatId);
      } else {
        // Bump unread and raise a notification (unless muted).
        final i = chats.indexWhere((c) => c.id == msg.chatId);
        if (i != -1) {
          final chat = chats[i];
          chats[i] = chat.copyWith(unread: chat.unread + 1);
          if (!chat.muted) {
            final sender = _userCache[msg.senderId]?.displayName ??
                (chat.isGroup ? chat.title : chat.title);
            final title = chat.isGroup ? chat.title : sender;
            final body = chat.isGroup ? '$sender: ${msg.body}' : msg.body;
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
    super.dispose();
  }
}
