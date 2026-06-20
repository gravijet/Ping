import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import 'package:url_launcher/url_launcher.dart';

import '../platform.dart';
import '../services/platform_files.dart';
import '../models/chat.dart';
import '../models/message.dart';
import '../models/scheduled_message.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/chat_wallpaper.dart';
import '../widgets/forward_sheet.dart';
import '../widgets/message_actions.dart';
import '../widgets/message_bubble.dart';
import '../widgets/verified_badge.dart';
import 'chat_info_screen.dart';
import 'image_viewer_screen.dart';
import 'sticker_draw_screen.dart';
import 'video_player_screen.dart';

class ChatScreen extends StatefulWidget {
  final String chatId;
  const ChatScreen({super.key, required this.chatId});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _scroll = ScrollController();
  final _input = TextEditingController();
  final _inputFocus = FocusNode();

  bool _loadingOlder = false;
  bool _hasMore = true;
  bool _isTyping = false;
  Timer? _typingTimer;
  Timer? _draftTimer;
  Message? _replyTo;
  Message? _editing;

  // "X neue Nachrichten" divider: how many were unread when the chat was
  // opened, and the id of the first unread message (the divider sits above it).
  int _initialUnread = 0;
  String? _unreadAnchorId;

  // Show a "jump to latest" button once the user scrolls up a fair distance.
  bool _showScrollDown = false;

  // Which pinned message the banner is currently showing (cycles on tap).
  int _pinIndex = 0;

  // In-chat search over the loaded messages.
  bool _searching = false;
  final _searchController = TextEditingController();
  String _searchQuery = '';

  // Jump-to-quoted-message: a stable key per message id so we can scroll to it,
  // plus a transient highlight on the message we just jumped to.
  final Map<String, GlobalKey> _messageKeys = {};
  String? _highlightId;
  Timer? _highlightTimer;

  // Attachments & voice recording
  final AudioRecorder _recorder = AudioRecorder();
  bool _uploading = false;
  bool _recording = false;
  String? _recordPath;
  DateTime? _recordStart;
  Timer? _recordTicker;
  Duration _recordElapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = context.read<AppState>();
    // Capture the unread count before setActiveChat clears it — it anchors the
    // "neue Nachrichten" divider.
    _initialUnread = _chat?.unread ?? 0;
    state.setActiveChat(widget.chatId);
    // Restore an unsent draft into the composer.
    final draft = state.draftFor(widget.chatId);
    if (draft.isNotEmpty) _input.text = draft;
    _scroll.addListener(_onScroll);
    _loadInitial();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    final state = context.read<AppState>();
    if (lifecycle == AppLifecycleState.resumed) {
      state.setActiveChat(widget.chatId);
    } else if (lifecycle == AppLifecycleState.paused) {
      state.setActiveChat(null);
      _stopTyping();
    }
  }

  Future<void> _loadInitial() async {
    final state = context.read<AppState>();
    state.loadScheduled(widget.chatId); // show any "send later" messages
    state.loadPins(widget.chatId); // 0.27.0: pinned-messages banner
    try {
      final fetched = await state.loadMessages(widget.chatId, reset: true);
      if (fetched.length < 40) _hasMore = false;
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  void _onScroll() {
    // Reversed list: "top" (older) is at max scroll extent.
    if (_scroll.position.pixels >=
            _scroll.position.maxScrollExtent - 200 &&
        !_loadingOlder &&
        _hasMore) {
      _loadOlder();
    }
    // In a reversed list, pixels grow as you scroll up away from the latest
    // message — surface a quick "back to bottom" button past a threshold.
    final showDown = _scroll.hasClients && _scroll.position.pixels > 600;
    if (showDown != _showScrollDown) {
      setState(() => _showScrollDown = showDown);
    }
  }

  Future<void> _loadOlder() async {
    setState(() => _loadingOlder = true);
    try {
      final fetched = await context.read<AppState>().loadMessages(widget.chatId);
      if (fetched.length < 40) _hasMore = false;
    } on ApiException catch (e) {
      _showError(e.message);
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  void _onInputChanged(String text) {
    final state = context.read<AppState>();
    if (text.trim().isNotEmpty &&
        !_isTyping &&
        state.settings.sendTypingIndicators) {
      _isTyping = true;
      state.socket.setTyping(widget.chatId, true);
    }
    _typingTimer?.cancel();
    _typingTimer = Timer(const Duration(seconds: 3), _stopTyping);
    // Persist the draft after a short pause in typing (not while editing an
    // existing message — that text isn't a draft).
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 600), () {
      if (mounted && _editing == null) {
        state.setDraft(widget.chatId, _input.text);
      }
    });
    setState(() {}); // refresh send button enabled state
  }

  void _stopTyping() {
    _typingTimer?.cancel();
    if (_isTyping) {
      _isTyping = false;
      context.read<AppState>().socket.setTyping(widget.chatId, false);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    final state = context.read<AppState>();
    _stopTyping();

    if (_editing != null) {
      final editing = _editing!;
      _input.clear();
      setState(() => _editing = null);
      try {
        await state.editMessage(widget.chatId, editing.id, text);
      } on ApiException catch (e) {
        _showError(e.message);
      }
      return;
    }

    final reply = _replyTo;
    _input.clear();
    setState(() => _replyTo = null);
    _draftTimer?.cancel();
    state.setDraft(widget.chatId, '');
    state.feedback.messageSent();
    try {
      await state.sendMessage(widget.chatId, text, replyTo: reply?.id);
      _scrollToBottom();
    } on ApiException catch (e) {
      _showError('Konnte nicht gesendet werden: ${e.message}');
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(0,
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOut);
      }
    });
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  /// Tapped a reply quote → bring the original message into view and flash it.
  Future<void> _jumpToMessage(String id) async {
    final state = context.read<AppState>();
    // A reply always points at an *older* message, so page back until it's
    // loaded (or we run out of history).
    var guard = 0;
    while (!state.messagesFor(widget.chatId).any((m) => m.id == id) &&
        _hasMore &&
        guard < 10) {
      guard++;
      await _loadOlder();
      if (!mounted) return;
    }
    if (!state.messagesFor(widget.chatId).any((m) => m.id == id)) {
      _showError('Die ursprüngliche Nachricht ist nicht mehr verfügbar.');
      return;
    }
    await _ensureVisibleById(id);
  }

  Future<void> _ensureVisibleById(String id) async {
    for (var attempt = 0; attempt < 14 && mounted; attempt++) {
      final ctx = _messageKeys[id]?.currentContext;
      if (ctx != null && ctx.mounted) {
        await Scrollable.ensureVisible(
          ctx,
          alignment: 0.35,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
        );
        _flashHighlight(id);
        return;
      }
      // Off-screen and not built yet — nudge toward older messages (higher
      // offset in this reverse list) so the builder materialises it, then retry.
      if (_scroll.hasClients) {
        final target = (_scroll.position.pixels + 700)
            .clamp(0.0, _scroll.position.maxScrollExtent);
        await _scroll.animateTo(target,
            duration: const Duration(milliseconds: 120), curve: Curves.linear);
      }
      await Future<void>.delayed(const Duration(milliseconds: 70));
    }
    _flashHighlight(id);
  }

  void _flashHighlight(String id) {
    if (!mounted) return;
    setState(() => _highlightId = id);
    _highlightTimer?.cancel();
    _highlightTimer = Timer(const Duration(milliseconds: 1700), () {
      if (mounted) setState(() => _highlightId = null);
    });
  }

  Chat? get _chat {
    final chats = context.read<AppState>().chats;
    final i = chats.indexWhere((c) => c.id == widget.chatId);
    return i == -1 ? null : chats[i];
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopTyping();
    _highlightTimer?.cancel();
    _recordTicker?.cancel();
    _draftTimer?.cancel();
    _recorder.dispose();
    final state = context.read<AppState>();
    // Keep whatever is left in the composer as the chat's draft.
    if (_editing == null) state.setDraft(widget.chatId, _input.text);
    state.setActiveChat(null);
    _scroll.dispose();
    _input.dispose();
    _inputFocus.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final chat = state.chats.firstWhere(
      (c) => c.id == widget.chatId,
      orElse: () => _chat ??
          Chat(
            id: widget.chatId,
            type: 'direct',
            title: 'Chat',
            avatarColor: '#5C6BC0',
            memberIds: const [],
            updatedAt: 0,
          ),
    );
    final messages = state.messagesFor(widget.chatId);

    final blockedOther = !chat.isGroup &&
        chat.otherUser != null &&
        state.isBlocked(chat.otherUser!.id);

    return Scaffold(
      appBar: _searching ? _buildSearchAppBar() : _buildAppBar(state, chat),
      body: Column(
        children: [
          if (!_searching && state.pinsFor(widget.chatId).isNotEmpty)
            _PinnedBanner(
              pins: state.pinsFor(widget.chatId),
              index: _pinIndex % state.pinsFor(widget.chatId).length,
              onTap: () {
                final pins = state.pinsFor(widget.chatId);
                if (pins.isEmpty) return;
                final i = _pinIndex % pins.length;
                _jumpToMessage(pins[i].id);
                setState(() => _pinIndex = i + 1);
              },
              onUnpin: () => _togglePin(
                  state.pinsFor(widget.chatId)[
                      _pinIndex % state.pinsFor(widget.chatId).length]),
            ),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: ChatWallpaper(
                    spec: state.wallpaperFor(widget.chatId),
                    fallback: context.ping.wallpaper,
                    dim: state.settings.wallpaperDim,
                  ),
                ),
                if (_searching)
                  _buildSearchResults(state, chat, messages)
                else
                  _buildMessageList(state, chat, messages),
                if (!_searching && _showScrollDown)
                  Positioned(
                    right: 14,
                    bottom: 14,
                    child: _ScrollDownButton(onTap: _scrollToBottom),
                  ),
              ],
            ),
          ),
          _TypingRow(chat: chat),
          if (!chat.locked && state.scheduledFor(widget.chatId).isNotEmpty)
            _ScheduledBar(
              items: state.scheduledFor(widget.chatId),
              onTap: () => _showScheduledSheet(state.scheduledFor(widget.chatId)),
            ),
          if (_uploading) const LinearProgressIndicator(minHeight: 2),
          if (!chat.locked && !blockedOther && (_replyTo != null || _editing != null))
            _composerBanner(),
          if (chat.locked)
            const _ReadOnlyBar()
          else if (blockedOther)
            _BlockedBar(
              name: chat.otherUser!.label,
              onUnblock: () async {
                try {
                  await context.read<AppState>().unblockUser(chat.otherUser!.id);
                } on ApiException catch (e) {
                  _showError(e.message);
                }
              },
            )
          else if (_recording)
            _buildRecordingBar()
          else
            _buildComposer(),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(AppState state, Chat chat) {
    final scheme = Theme.of(context).colorScheme;
    final online = !chat.isGroup &&
        !chat.self &&
        chat.otherUser != null &&
        state.isOnline(chat.otherUser!.id);
    final typingUsers = state.typingIn(chat.id);
    String subtitle;
    if (chat.self) {
      subtitle = 'Nachrichten an dich selbst';
    } else if (typingUsers.isNotEmpty) {
      subtitle = chat.isGroup
          ? (typingUsers.length == 1
              ? '${state.cachedUser(typingUsers.first)?.displayName.split(' ').first ?? 'Jemand'} tippt …'
              : 'mehrere tippen …')
          : 'tippt …';
    } else if (chat.otherUser?.official == true) {
      subtitle = 'Offizieller Kanal · verifiziert';
    } else if (chat.isGroup) {
      subtitle = '${chat.memberIds.length} Mitglieder';
    } else if (online) {
      subtitle = 'online';
    } else if (state.settings.showContactMood &&
        chat.otherUser?.hasMood == true) {
      // When a contact has a status/mood set, surface it instead of a stale
      // "last seen" — a livelier, more personal header.
      subtitle = chat.otherUser!.moodLine;
    } else {
      subtitle = TimeFormat.lastSeen(chat.otherUser?.lastSeen);
    }
    final headerUser = chat.isGroup ? null : chat.otherUser;

    return AppBar(
      titleSpacing: 0,
      title: InkWell(
        onTap: () => _openInfo(chat),
        child: Row(
          children: [
            PingAvatar(
              initials: chat.isGroup
                  ? chat.initials
                  : (chat.otherUser?.initials ?? chat.initials),
              color: chat.color,
              size: 40,
              online: chat.isGroup ? null : online,
              icon: chat.isGroup
                  ? Icons.groups_rounded
                  : (chat.self ? Icons.bookmark_rounded : null),
              imageUrl: chat.isGroup
                  ? state.groupAvatarUrl(chat)
                  : state.avatarUrl(chat.otherUser),
              imageHeaders: state.authHeaders,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  NameWithBadge(
                    name: chat.displayTitle,
                    user: headerUser,
                    glow: headerUser?.official == true,
                    badgeSize: 18,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: headerUser?.official == true
                          ? scheme.primary
                          : typingUsers.isNotEmpty || online
                              ? scheme.primary
                              : scheme.onSurfaceVariant,
                      fontWeight: headerUser?.official == true
                          ? FontWeight.w700
                          : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        if (!chat.isGroup &&
            !chat.self &&
            !chat.locked &&
            chat.otherUser != null &&
            state.feature('calls')) ...[
          IconButton(
            icon: const Icon(Icons.videocam_rounded),
            tooltip: 'Videoanruf',
            onPressed: () => _startCall(chat.otherUser!, video: true),
          ),
          IconButton(
            icon: const Icon(Icons.call_rounded),
            tooltip: 'Sprachanruf',
            onPressed: () => _startCall(chat.otherUser!, video: false),
          ),
        ],
        IconButton(
          icon: const Icon(Icons.search_rounded),
          tooltip: 'In Chat suchen',
          onPressed: _enterSearch,
        ),
        IconButton(
          icon: const Icon(Icons.info_outline_rounded),
          tooltip: 'Chat-Infos',
          onPressed: () => _openInfo(chat),
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  Future<void> _startCall(PingUser user, {required bool video}) async {
    try {
      await context.read<AppState>().callController.startCall(user, video: video);
    } catch (_) {
      _showError('Anruf konnte nicht gestartet werden. '
          'Prüfe die Kamera-/Mikrofon-Berechtigung.');
    }
  }

  PreferredSizeWidget _buildSearchAppBar() {
    return AppBar(
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_rounded),
        onPressed: _exitSearch,
      ),
      titleSpacing: 0,
      title: TextField(
        controller: _searchController,
        autofocus: true,
        style: const TextStyle(color: Colors.white, fontSize: 17),
        cursorColor: Colors.white,
        onChanged: (v) => setState(() => _searchQuery = v),
        decoration: const InputDecoration(
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          filled: false,
          hintText: 'In dieser Unterhaltung suchen …',
          hintStyle: TextStyle(color: Colors.white70),
        ),
      ),
      actions: [
        if (_searchQuery.isNotEmpty)
          IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: () => setState(() {
              _searchController.clear();
              _searchQuery = '';
            }),
          ),
      ],
    );
  }

  void _enterSearch() => setState(() => _searching = true);

  void _exitSearch() => setState(() {
        _searching = false;
        _searchController.clear();
        _searchQuery = '';
      });

  void _openInfo(Chat chat) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ChatInfoScreen(chatId: chat.id)),
    );
  }

  Widget _buildMessageList(AppState state, Chat chat, List<Message> messages) {
    if (messages.isEmpty) {
      return _EmptyConversation(
        chat: chat,
        imageUrl: chat.isGroup
            ? state.groupAvatarUrl(chat)
            : state.avatarUrl(chat.otherUser),
        imageHeaders: state.authHeaders,
      );
    }

    // Anchor the "neue Nachrichten" divider to the first message that was
    // unread when the chat was opened. Computed once, so it stays put while
    // new messages arrive below it.
    if (_unreadAnchorId == null &&
        _initialUnread > 0 &&
        messages.length >= _initialUnread) {
      _unreadAnchorId = messages[messages.length - _initialUnread].id;
    }

    // Build a flat list of items in chronological order: a day divider sits
    // directly *above* the first message of each day. The list is then reversed
    // for the bottom-anchored (reverse: true) ListView.
    final items = <_ListItem>[];
    for (var i = 0; i < messages.length; i++) {
      final m = messages[i];
      final prev = i > 0 ? messages[i - 1] : null;
      if (prev == null || !_sameDay(prev.time, m.time)) {
        items.add(_ListItem.divider(m.time));
      }
      if (m.id == _unreadAnchorId && i > 0) {
        items.add(_ListItem.unread());
      }
      items.add(_ListItem.message(m));
    }
    final reversed = items.reversed.toList();

    return ListView.builder(
      controller: _scroll,
      reverse: true,
      padding: const EdgeInsets.symmetric(vertical: 10),
      itemCount: reversed.length + (_loadingOlder ? 1 : 0),
      itemBuilder: (context, index) {
        if (_loadingOlder && index == reversed.length) {
          return const Padding(
            padding: EdgeInsets.all(12),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            ),
          );
        }
        final item = reversed[index];
        if (item.isUnread) {
          return _UnreadDivider(count: _initialUnread);
        }
        if (item.isDivider) {
          return _DayDivider(label: TimeFormat.dayDivider(item.time!));
        }
        return _buildBubble(state, chat, messages, item.message!);
      },
    );
  }

  Widget _buildSearchResults(
      AppState state, Chat chat, List<Message> messages) {
    final q = _searchQuery.trim().toLowerCase();
    if (q.isEmpty) {
      return const _SearchHint(
        icon: Icons.search_rounded,
        text: 'Gib einen Begriff ein, um diese Unterhaltung zu durchsuchen.',
      );
    }
    final matches = messages
        .where((m) =>
            !m.isSystem && !m.deleted && m.body.toLowerCase().contains(q))
        .toList()
        .reversed
        .toList();
    if (matches.isEmpty) {
      return const _SearchHint(
        icon: Icons.search_off_rounded,
        text: 'Keine Treffer in den geladenen Nachrichten.',
      );
    }
    final scheme = Theme.of(context).colorScheme;
    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 6),
      itemCount: matches.length,
      separatorBuilder: (_, _) => Divider(
        height: 1,
        indent: 20,
        endIndent: 20,
        color: scheme.outlineVariant.withValues(alpha: 0.3),
      ),
      itemBuilder: (context, i) {
        final m = matches[i];
        final mine = m.senderId == state.me?.id;
        final who = mine
            ? 'Du'
            : state.cachedUser(m.senderId ?? '')?.displayName ??
                chat.displayTitle;
        return ListTile(
          tileColor: scheme.surface.withValues(alpha: 0.85),
          leading: CircleAvatar(
            backgroundColor: scheme.primary.withValues(alpha: 0.12),
            child: Icon(Icons.chat_bubble_outline_rounded,
                size: 18, color: scheme.primary),
          ),
          title: Text(who,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          subtitle:
              Text(m.preview, maxLines: 2, overflow: TextOverflow.ellipsis),
          trailing: Text(TimeFormat.chatStamp(m.time),
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 11)),
          onTap: () {
            final id = m.id;
            _exitSearch();
            WidgetsBinding.instance
                .addPostFrameCallback((_) => _jumpToMessage(id));
          },
        );
      },
    );
  }

  Widget _buildBubble(
      AppState state, Chat chat, List<Message> messages, Message m,
      {bool interactive = true}) {
    final isMine = m.senderId == state.me?.id;
    final sender = m.senderId != null ? state.cachedUser(m.senderId!) : null;
    // Prefer the fully-loaded original (so edits/deletes show live); fall back
    // to the server-supplied snapshot when it's outside the loaded window.
    final replied = (m.replyTo != null
            ? messages
                .where((x) => x.id == m.replyTo)
                .cast<Message?>()
                .firstWhere((x) => true, orElse: () => null)
            : null) ??
        m.quoted;
    final repliedSender = replied == null
        ? null
        : replied.senderId == state.me?.id
            ? 'Du'
            : state.cachedUser(replied.senderId ?? '')?.displayName;

    return MessageBubble(
      key: interactive
          ? _messageKeys.putIfAbsent(m.id, () => GlobalKey())
          : null,
      message: m,
      isMine: isMine,
      showSenderName: chat.isGroup && !isMine,
      senderName: sender?.displayName,
      senderColor: sender?.color ?? Theme.of(context).colorScheme.primary,
      senderBadge: chat.isGroup && !isMine ? badgeKindFor(sender) : null,
      official: chat.locked && chat.otherUser?.official == true,
      repliedTo: replied,
      repliedToSender: repliedSender,
      starred: state.isStarred(m.id),
      highlighted: interactive && _highlightId == m.id,
      onTapQuote: interactive && m.replyTo != null
          ? () => _jumpToMessage(m.replyTo!)
          : null,
      onLongPress: interactive ? () => _showMessageActions(m, isMine) : null,
      onSwipeReply:
          interactive && !m.deleted ? () => _startReply(m) : null,
      onDoubleTap: interactive && !m.deleted
          ? () => state.toggleReaction(widget.chatId, m.id, '❤️')
          : null,
      resolveUrl: state.mediaUrl,
      mediaHeaders: state.authHeaders,
      audio: state.audio,
      onOpenImage: _openImage,
      onOpenFile: _openFile,
      onPlayAudio: _playAudio,
      onOpenVideo: _openVideo,
      textScale: state.settings.fontScale,
      cornerScale: state.settings.bubbleCorners,
      bigEmoji: state.settings.bigEmoji,
      formatting: state.settings.messageFormatting,
      accentBubbles: state.settings.accentBubbles,
      onToggleReaction: interactive
          ? (emoji) => state.toggleReaction(widget.chatId, m.id, emoji)
          : null,
      onVotePoll: interactive && m.poll != null
          ? (option) => _votePoll(m, option)
          : null,
    );
  }

  Future<void> _votePoll(Message m, int option) async {
    try {
      await context.read<AppState>().votePoll(widget.chatId, m.id, option);
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  void _startReply(Message m) {
    setState(() {
      _replyTo = m;
      _editing = null;
    });
    _inputFocus.requestFocus();
  }

  void _showMessageActions(Message m, bool isMine) {
    if (m.deleted || m.isSystem) return;
    final state = context.read<AppState>();
    final chat = _chat;
    final selfChat = chat?.self ?? false;
    final messages = state.messagesFor(widget.chatId);
    final hasText = m.body.trim().isNotEmpty;
    final starred = state.isStarred(m.id);

    // Where the tapped bubble sits, so the menu can animate from there.
    Rect? rect;
    final box = _messageKeys[m.id]?.currentContext?.findRenderObject();
    if (box is RenderBox && box.hasSize) {
      rect = box.localToGlobal(Offset.zero) & box.size;
    }

    final actions = <MessageAction>[
      MessageAction(
        icon: Icons.reply_rounded,
        label: 'Antworten',
        onTap: () => _startReply(m),
      ),
      // Polls are bound to their chat (votes live there) — no forwarding.
      if (m.poll == null)
        MessageAction(
          icon: Icons.forward_rounded,
          label: 'Weiterleiten',
          onTap: () => _forwardMessage(m),
        ),
      if (hasText)
        MessageAction(
          icon: Icons.copy_rounded,
          label: 'Kopieren',
          onTap: () {
            Clipboard.setData(ClipboardData(text: m.body));
            _showError('In die Zwischenablage kopiert.');
          },
        ),
      MessageAction(
        icon: starred ? Icons.star_rounded : Icons.star_outline_rounded,
        label: starred ? 'Nicht mehr speichern' : 'Markieren',
        onTap: () => _toggleStar(m),
      ),
      if (!selfChat)
        MessageAction(
          icon: (m.pinned || state.pinsFor(widget.chatId).any((p) => p.id == m.id))
              ? Icons.push_pin_rounded
              : Icons.push_pin_outlined,
          label: (m.pinned || state.pinsFor(widget.chatId).any((p) => p.id == m.id))
              ? 'Loslösen'
              : 'Anpinnen',
          onTap: () => _togglePin(m),
        ),
      if (isMine && !selfChat)
        MessageAction(
          icon: Icons.info_outline_rounded,
          label: 'Info',
          onTap: () => _showMessageInfo(m),
        ),
      if (hasText && state.settings.ttsEnabled)
        MessageAction(
          icon: Icons.volume_up_rounded,
          label: 'Vorlesen',
          onTap: () => state.tts.speak(m.id, m.body),
        ),
      if (isMine && !m.isMedia)
        MessageAction(
          icon: Icons.edit_rounded,
          label: 'Bearbeiten',
          onTap: () {
            setState(() {
              _editing = m;
              _replyTo = null;
              _input.text = m.body;
            });
            _inputFocus.requestFocus();
          },
        ),
      MessageAction(
        icon: Icons.visibility_off_outlined,
        label: 'Für mich löschen',
        destructive: !isMine,
        onTap: () => _hideForMe(m),
      ),
      if (isMine)
        MessageAction(
          icon: Icons.delete_outline_rounded,
          label: 'Für alle löschen',
          destructive: true,
          onTap: () => _confirmDelete(m),
        ),
    ];

    showMessageActionsMenu(
      context,
      bubblePreview: chat != null
          ? _buildBubble(state, chat, messages, m, interactive: false)
          : const SizedBox.shrink(),
      isMine: isMine,
      selectedReactions: m.myReactions,
      onReact: (emoji) => state.toggleReaction(widget.chatId, m.id, emoji),
      onMore: () => _openReactionPicker(m),
      actions: actions,
      originRect: rect,
    );
  }

  /// Full emoji grid for reacting with any emoji (the "+" in the reaction pill).
  void _openReactionPicker(Message m) {
    final state = context.read<AppState>();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        builder: (c, controller) => GridView.count(
          controller: controller,
          crossAxisCount: 6,
          padding: const EdgeInsets.all(12),
          children: [
            for (final e in _reactionEmojis)
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () {
                  Navigator.pop(ctx);
                  state.toggleReaction(widget.chatId, m.id, e);
                },
                child: Center(
                  child: Text(e, style: const TextStyle(fontSize: 30)),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _toggleStar(Message m) {
    context.read<AppState>().toggleStar(m, _chat?.displayTitle ?? 'Chat');
  }

  Future<void> _togglePin(Message m) async {
    final state = context.read<AppState>();
    final wasPinned =
        m.pinned || state.pinsFor(widget.chatId).any((p) => p.id == m.id);
    try {
      await state.setMessagePinned(m, !wasPinned);
      if (mounted) _showError(wasPinned ? 'Losgelöst.' : 'Angepinnt.');
    } catch (e) {
      if (mounted) {
        _showError(e is ApiException ? e.message : 'Aktion fehlgeschlagen.');
      }
    }
  }

  Future<void> _forwardMessage(Message m) async {
    final targets = await showForwardSheet(context);
    if (targets == null || targets.isEmpty || !mounted) return;
    try {
      await context.read<AppState>().forwardMessage(m, targets);
      if (!mounted) return;
      _showError(targets.length == 1
          ? 'Weitergeleitet.'
          : 'An ${targets.length} Chats weitergeleitet.');
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  /// "Für mich löschen": removes the message on this account only — the rest
  /// of the chat keeps it. Used for tidying up your own view.
  Future<void> _hideForMe(Message m) async {
    // The "Vor dem Löschen nachfragen" privacy toggle controls the safety
    // prompt; with it off, power users delete in one tap.
    if (context.read<AppState>().settings.confirmBeforeDelete) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Für mich löschen?'),
          content: const Text(
              'Die Nachricht verschwindet nur bei dir. Alle anderen im Chat '
              'sehen sie weiterhin.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Abbrechen')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Für mich löschen'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    try {
      await context.read<AppState>().hideMessageForMe(widget.chatId, m.id);
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  Future<void> _confirmDelete(Message m) async {
    if (context.read<AppState>().settings.confirmBeforeDelete) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Nachricht löschen?'),
          content: const Text(
              'Die Nachricht wird für alle in diesem Chat entfernt. Das lässt '
              'sich nicht rückgängig machen.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Abbrechen')),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.error),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Löschen'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    if (!mounted) return;
    try {
      await context.read<AppState>().deleteMessage(widget.chatId, m.id);
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  void _showMessageInfo(Message m) {
    final state = context.read<AppState>();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _MessageInfoSheet(
        future: state.messageReceipts(widget.chatId, m.id),
        message: m,
        state: state,
      ),
    );
  }

  // ---- Attachments & voice -------------------------------------------------

  void _openAttachmentSheet() {
    _stopTyping();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          child: Wrap(
            spacing: 22,
            runSpacing: 20,
            alignment: WrapAlignment.center,
            children: [
              _AttachOption(
                icon: Icons.photo_library_rounded,
                color: const Color(0xFF7E57C2),
                label: 'Galerie',
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImage(ImageSource.gallery);
                },
              ),
              _AttachOption(
                icon: Icons.photo_camera_rounded,
                color: const Color(0xFFEC407A),
                label: 'Kamera',
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImage(ImageSource.camera);
                },
              ),
              _AttachOption(
                icon: Icons.videocam_rounded,
                color: const Color(0xFFEF5350),
                label: 'Video',
                onTap: () {
                  Navigator.pop(ctx);
                  _chooseVideoSource();
                },
              ),
              _AttachOption(
                icon: Icons.emoji_emotions_rounded,
                color: const Color(0xFFFFA000),
                label: 'Sticker',
                onTap: () {
                  Navigator.pop(ctx);
                  _openStickerSheet();
                },
              ),
              _AttachOption(
                icon: Icons.gif_box_rounded,
                color: const Color(0xFF26A69A),
                label: 'GIF',
                onTap: () {
                  Navigator.pop(ctx);
                  _pickGif();
                },
              ),
              _AttachOption(
                icon: Icons.insert_drive_file_rounded,
                color: const Color(0xFF42A5F5),
                label: 'Datei',
                onTap: () {
                  Navigator.pop(ctx);
                  _pickFile();
                },
              ),
              _AttachOption(
                icon: Icons.poll_rounded,
                color: const Color(0xFF5C6BC0),
                label: 'Umfrage',
                onTap: () {
                  Navigator.pop(ctx);
                  _openPollComposer();
                },
              ),
              _AttachOption(
                icon: Icons.bolt_rounded,
                color: const Color(0xFFFFB300),
                label: 'Schnellantwort',
                onTap: () {
                  Navigator.pop(ctx);
                  _showQuickReplies();
                },
              ),
              _AttachOption(
                icon: Icons.mic_rounded,
                color: const Color(0xFFFF7043),
                label: 'Sprache',
                onTap: () {
                  Navigator.pop(ctx);
                  _startRecording();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Pick a canned message and drop it into the composer (appending to whatever
  /// is already there). Editable in Einstellungen → Chats → Schnellantworten.
  Future<void> _showQuickReplies() async {
    final state = context.read<AppState>();
    final replies = state.quickReplies;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: replies.isEmpty
            ? const Padding(
                padding: EdgeInsets.fromLTRB(24, 8, 24, 32),
                child: Text(
                  'Noch keine Schnellantworten. Lege welche in den Einstellungen '
                  '→ Chats → Schnellantworten an.',
                  textAlign: TextAlign.center,
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 6),
                    child: Row(
                      children: [
                        const Icon(Icons.bolt_rounded, size: 20),
                        const SizedBox(width: 8),
                        Text('Schnellantworten',
                            style: Theme.of(ctx).textTheme.titleMedium),
                      ],
                    ),
                  ),
                  Flexible(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final r in replies)
                          ListTile(
                            dense: true,
                            title: Text(r,
                                maxLines: 2, overflow: TextOverflow.ellipsis),
                            onTap: () => Navigator.pop(ctx, r),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
    if (chosen == null || !mounted) return;
    final existing = _input.text;
    final needsSpace = existing.isNotEmpty && !existing.endsWith(' ');
    _input.text = needsSpace ? '$existing $chosen' : '$existing$chosen';
    _input.selection =
        TextSelection.collapsed(offset: _input.text.length);
    _onInputChanged(_input.text);
    _inputFocus.requestFocus();
  }

  Future<void> _openPollComposer() async {
    final result = await showModalBottomSheet<_PollDraft>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const _PollComposerSheet(),
    );
    if (result == null || !mounted) return;
    try {
      await context.read<AppState>().createPoll(
            widget.chatId,
            result.question,
            result.options,
            multi: result.multi,
          );
      _scrollToBottom();
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  String _imageMime(String path) {
    final p = path.toLowerCase();
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.webp')) return 'image/webp';
    if (p.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  String _mimeForFile(String name) {
    final p = name.toLowerCase();
    const map = {
      '.pdf': 'application/pdf',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
    };
    for (final e in map.entries) {
      if (p.endsWith(e.key)) return e.value;
    }
    return 'application/octet-stream';
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final file = await picker.pickImage(
          source: source, imageQuality: 85, maxWidth: 1920);
      if (file == null) return;
      final bytes = await file.readAsBytes();
      await _sendBytes(bytes, file.mimeType ?? _imageMime(file.path),
          filename: file.name, kind: 'image');
    } catch (_) {
      _showError('Bild konnte nicht geladen werden.');
    }
  }

  // A built-in set of emoji "stickers" — no external pack/file needed. Tapping
  // one sends it as an emoji-only message, which renders large (jumbo) in the
  // bubble. The "Zeichnen" action opens a canvas to draw a custom sticker.
  static const _stickerEmojis = [
    '😀','😂','🤣','😍','🥰','😎','🤩','😭','😅','😉',
    '😴','🤔','🙄','😱','🥳','😡','😇','🤗','🤫','🤤',
    '👍','👎','👏','🙏','🙌','💪','👌','🤝','✌️','🤞',
    '❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','💯',
    '🔥','✨','🎉','🎊','⭐','🌟','💩','👀','🫶','🤙',
    '🐶','🐱','🦄','🍕','🍔','☕','⚽','🎮','🚀','🌈',
  ];

  // A broad set of emoji offered when reacting via the reaction pill's "+".
  static const _reactionEmojis = [
    '👍','👎','❤️','🔥','🥰','👏','😁','😂','🤣','😊',
    '😍','😮','😢','😡','🥳','😎','🤔','🙄','😴','🤯',
    '🤗','🤝','🙏','💪','✌️','🤙','👌','🫶','💯','✨',
    '🎉','🎊','⭐','🌟','💔','💕','😅','😭','😱','🤤',
  ];

  void _openStickerSheet() {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.55,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        builder: (c, controller) => Column(
          children: [
            ListTile(
              leading: const Icon(Icons.brush_rounded),
              title: const Text('Eigenen Sticker zeichnen'),
              subtitle: const Text('Mal etwas und sende es als Sticker'),
              onTap: () {
                Navigator.pop(ctx);
                _drawSticker();
              },
            ),
            const Divider(height: 1),
            Expanded(
              child: GridView.count(
                controller: controller,
                crossAxisCount: 5,
                padding: const EdgeInsets.all(12),
                children: [
                  for (final e in _stickerEmojis)
                    InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () {
                        Navigator.pop(ctx);
                        _sendEmojiSticker(e);
                      },
                      child: Center(
                        child: Text(e, style: const TextStyle(fontSize: 38)),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _sendEmojiSticker(String emoji) async {
    final state = context.read<AppState>();
    final reply = _replyTo;
    setState(() => _replyTo = null);
    try {
      await state.sendMessage(widget.chatId, emoji, replyTo: reply?.id);
      _scrollToBottom();
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  Future<void> _drawSticker() async {
    final bytes = await Navigator.of(context).push<Uint8List?>(
      MaterialPageRoute(builder: (_) => const StickerDrawScreen()),
    );
    if (bytes == null || bytes.isEmpty || !mounted) return;
    await _sendBytes(bytes, 'image/png',
        filename: 'sticker.png', kind: 'image');
  }

  Future<void> _chooseVideoSource() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.videocam_rounded),
              title: const Text('Video aufnehmen'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.video_library_rounded),
              title: const Text('Video aus Galerie'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    await _pickVideo(source);
  }

  Future<void> _pickVideo(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final file = await picker.pickVideo(
          source: source, maxDuration: const Duration(minutes: 5));
      if (file == null) return;
      final bytes = await file.readAsBytes();
      await _sendBytes(bytes, file.mimeType ?? _mimeForFile(file.name),
          filename: file.name, kind: 'video');
    } catch (_) {
      _showError('Video konnte nicht geladen werden.');
    }
  }

  Future<void> _pickGif() async {
    try {
      final res = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['gif'],
        withData: true,
      );
      if (res == null || res.files.isEmpty) return;
      final f = res.files.first;
      if (f.bytes == null) return;
      await _sendBytes(f.bytes!, 'image/gif', filename: f.name, kind: 'gif');
    } catch (_) {
      _showError('GIF konnte nicht geladen werden.');
    }
  }

  Future<void> _pickFile() async {
    try {
      final res = await FilePicker.pickFiles(withData: true);
      if (res == null || res.files.isEmpty) return;
      final f = res.files.first;
      if (f.bytes == null) {
        _showError('Datei konnte nicht gelesen werden.');
        return;
      }
      await _sendBytes(f.bytes!, _mimeForFile(f.name), filename: f.name);
    } catch (_) {
      _showError('Datei konnte nicht geladen werden.');
    }
  }

  Future<void> _sendBytes(
    List<int> bytes,
    String contentType, {
    String? filename,
    String? kind,
    int? durationMs,
  }) async {
    if (bytes.length > 30 * 1024 * 1024) {
      _showError('Die Datei ist zu groß (max. 30 MB).');
      return;
    }
    final state = context.read<AppState>();
    final reply = _replyTo;
    setState(() {
      _uploading = true;
      _replyTo = null;
    });
    try {
      final att = await state.uploadAttachment(bytes, contentType,
          filename: filename, kind: kind, durationMs: durationMs);
      await state.sendAttachment(widget.chatId, att, replyTo: reply?.id);
      _scrollToBottom();
    } on ApiException catch (e) {
      _showError(e.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _startRecording() async {
    try {
      if (!await _recorder.hasPermission()) {
        _showError('Ohne Mikrofon-Berechtigung geht das leider nicht.');
        return;
      }
      final path = await recordTargetPath(
          'voice_${DateTime.now().millisecondsSinceEpoch}.m4a');
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc),
          path: path);
      _recordPath = path;
      _recordStart = DateTime.now();
      _recordElapsed = Duration.zero;
      _recordTicker?.cancel();
      _recordTicker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || _recordStart == null) return;
        setState(() => _recordElapsed = DateTime.now().difference(_recordStart!));
      });
      _stopTyping();
      setState(() => _recording = true);
    } catch (_) {
      _showError('Aufnahme konnte nicht gestartet werden.');
    }
  }

  Future<void> _cancelRecording() async {
    _recordTicker?.cancel();
    try {
      await _recorder.stop();
    } catch (_) {}
    if (_recordPath != null) {
      await deleteLocalFile(_recordPath!);
    }
    setState(() {
      _recording = false;
      _recordPath = null;
    });
  }

  Future<void> _stopAndSendRecording() async {
    _recordTicker?.cancel();
    final durationMs = _recordStart != null
        ? DateTime.now().difference(_recordStart!).inMilliseconds
        : null;
    String? path;
    try {
      path = await _recorder.stop();
    } catch (_) {}
    path ??= _recordPath;
    setState(() => _recording = false);
    if (path == null) return;
    try {
      final bytes = await readLocalBytes(path);
      if (bytes == null || bytes.isEmpty) return;
      await _sendBytes(bytes, 'audio/mp4',
          filename: 'sprachnachricht.m4a', kind: 'voice', durationMs: durationMs);
    } catch (_) {
      _showError('Sprachnachricht konnte nicht gesendet werden.');
    }
  }

  void _openImage(Attachment att) {
    final state = context.read<AppState>();
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ImageViewerScreen(
        url: state.mediaUrl(att.url),
        headers: state.authHeaders,
      ),
    ));
  }

  void _openVideo(Attachment att) {
    // The lite clients (Windows desktop + web) don't ship inline video playback
    // yet. Tell the user rather than crash on an unsupported call.
    if (isLiteClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                'Videos lassen sich in der Web- und Desktop-App noch nicht abspielen.')),
      );
      return;
    }
    final state = context.read<AppState>();
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => VideoPlayerScreen(
        url: state.mediaUrl(att.url),
        headers: state.authHeaders,
      ),
    ));
  }

  Future<void> _playAudio(Attachment att) async {
    final state = context.read<AppState>();
    if (state.audio.isCurrent(att.url)) {
      await state.audio.toggleFile(att.url, '');
      return;
    }
    final path = await state.media.cacheToFile(
        state.mediaUrl(att.url), state.authHeaders,
        suggestedName: att.name ?? 'audio.m4a');
    if (path == null) {
      if (mounted) _showError('Audio konnte nicht geladen werden.');
      return;
    }
    await state.audio.toggleFile(att.url, path);
  }

  Future<void> _openFile(Attachment att) async {
    final state = context.read<AppState>();
    _showError('Datei wird geladen …');
    final path = await state.media.saveToDevice(
        state.mediaUrl(att.url), state.authHeaders,
        suggestedName: att.name);
    if (!mounted) return;
    if (path == null) {
      _showError('Download fehlgeschlagen.');
      return;
    }
    try {
      final ok =
          await launchUrl(Uri.file(path), mode: LaunchMode.externalApplication);
      if (!ok && mounted) _showError('Gespeichert: $path');
    } catch (_) {
      if (mounted) _showError('Gespeichert: $path');
    }
  }

  Widget _composerBanner() {
    final scheme = Theme.of(context).colorScheme;
    final editing = _editing != null;
    final m = editing ? _editing! : _replyTo!;
    final state = context.read<AppState>();
    final senderName = m.senderId == state.me?.id
        ? 'Du'
        : state.cachedUser(m.senderId ?? '')?.displayName ?? '';
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      color: scheme.surfaceContainerHigh,
      child: Row(
        children: [
          Icon(editing ? Icons.edit_rounded : Icons.reply_rounded,
              color: scheme.primary, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  editing ? 'Nachricht bearbeiten' : 'Antwort an $senderName',
                  style: TextStyle(
                      color: scheme.primary,
                      fontWeight: FontWeight.w700,
                      fontSize: 13),
                ),
                Text(
                  m.body,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: scheme.onSurfaceVariant, fontSize: 13),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: () => setState(() {
              _replyTo = null;
              if (_editing != null) {
                _editing = null;
                _input.clear();
              }
            }),
          ),
        ],
      ),
    );
  }

  /// Wrap the current selection (or insert an empty pair at the cursor) with a
  /// formatting [marker] like `*`, `_`, `~`, `` ` `` or `||`.
  void _applyFormat(String marker) {
    final text = _input.text;
    final sel = _input.selection;
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    final selected = text.substring(start, end);
    final newText = text.replaceRange(start, end, '$marker$selected$marker');
    final newSel = selected.isEmpty
        ? TextSelection.collapsed(offset: start + marker.length)
        : TextSelection(
            baseOffset: start + marker.length,
            extentOffset: end + marker.length,
          );
    setState(() {
      _input.value = TextEditingValue(text: newText, selection: newSel);
    });
    context.read<AppState>().setDraft(widget.chatId, _input.text);
    _inputFocus.requestFocus();
  }

  /// Long-pressed send → pick a date + time and schedule the current text.
  Future<void> _scheduleCurrentMessage() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(hours: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      helpText: 'Sendedatum wählen',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))),
      helpText: 'Sendezeit wählen',
    );
    if (time == null || !mounted) return;
    final when = DateTime(
        date.year, date.month, date.day, time.hour, time.minute);
    if (when.isBefore(now.add(const Duration(seconds: 10)))) {
      _showError('Bitte einen Zeitpunkt in der Zukunft wählen.');
      return;
    }
    final reply = _replyTo;
    try {
      await context.read<AppState>().scheduleMessage(
            widget.chatId,
            body: text,
            replyTo: reply?.id,
            sendAt: when.millisecondsSinceEpoch,
          );
      if (!mounted) return;
      _input.clear();
      setState(() => _replyTo = null);
      context.read<AppState>().setDraft(widget.chatId, '');
      _showError('Geplant für ${TimeFormat.dateTime(when)}');
    } on ApiException catch (e) {
      _showError(e.message);
    }
  }

  void _showScheduledSheet(List<ScheduledMessage> items) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Row(
                children: [
                  const Icon(Icons.schedule_rounded, size: 20),
                  const SizedBox(width: 10),
                  Text('Geplante Nachrichten',
                      style: Theme.of(ctx).textTheme.titleMedium),
                ],
              ),
            ),
            for (final s in items)
              ListTile(
                title: Text(s.preview, maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text(TimeFormat.dateTime(s.sendTime)),
                trailing: IconButton(
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Abbrechen',
                  onPressed: () async {
                    try {
                      await context
                          .read<AppState>()
                          .cancelScheduled(widget.chatId, s.id);
                    } on ApiException catch (e) {
                      _showError(e.message);
                    }
                    if (ctx.mounted) Navigator.pop(ctx);
                  },
                ),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _showFormatSheet() {
    const options = <(String, String, IconData)>[
      ('Fett', '*', Icons.format_bold_rounded),
      ('Kursiv', '_', Icons.format_italic_rounded),
      ('Durchgestrichen', '~', Icons.format_strikethrough_rounded),
      ('Monospace', '`', Icons.code_rounded),
      ('Spoiler', '||', Icons.visibility_off_rounded),
    ];
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (label, marker, icon) in options)
              ListTile(
                leading: Icon(icon),
                title: Text(label),
                trailing: Text('$marker…$marker',
                    style: const TextStyle(fontFamily: 'monospace')),
                onTap: () {
                  Navigator.pop(ctx);
                  _applyFormat(marker);
                },
              ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  Widget _buildComposer() {
    final scheme = Theme.of(context).colorScheme;
    final settings = context.read<AppState>().settings;
    final enterToSend = settings.enterToSend;
    final canSend = _input.text.trim().isNotEmpty;
    final showSend = canSend || _editing != null;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(4, 6, 8, 6),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(
              top: BorderSide(
                  color: scheme.outlineVariant.withValues(alpha: 0.4))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            IconButton(
              icon: const Icon(Icons.add_circle_outline_rounded),
              tooltip: 'Anhang',
              onPressed: _uploading ? null : _openAttachmentSheet,
            ),
            IconButton(
              icon: const Icon(Icons.text_format_rounded),
              tooltip: 'Formatierung',
              visualDensity: VisualDensity.compact,
              onPressed: _showFormatSheet,
            ),
            Expanded(
              child: TextField(
                controller: _input,
                focusNode: _inputFocus,
                onChanged: _onInputChanged,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                // Honour the "Inkognito-Tastatur" privacy toggle by asking the
                // keyboard not to learn from (or autocomplete) what's typed here.
                enableIMEPersonalizedLearning: !settings.incognitoKeyboard,
                keyboardType: enterToSend
                    ? TextInputType.text
                    : TextInputType.multiline,
                textInputAction:
                    enterToSend ? TextInputAction.send : TextInputAction.newline,
                onSubmitted: enterToSend ? (_) => _send() : null,
                decoration: InputDecoration(
                  hintText: 'Nachricht schreiben …',
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 11),
                  fillColor: scheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                ),
              ),
            ),
            if (!showSend)
              IconButton(
                icon: const Icon(Icons.photo_camera_rounded),
                tooltip: 'Kamera',
                onPressed:
                    _uploading ? null : () => _pickImage(ImageSource.camera),
              ),
            const SizedBox(width: 2),
            Material(
              color: scheme.primary,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _uploading ? null : (showSend ? _send : _startRecording),
                // Hold the send button to schedule the message for later.
                onLongPress: (!_uploading && canSend && _editing == null)
                    ? _scheduleCurrentMessage
                    : null,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Icon(
                    showSend
                        ? (_editing != null
                            ? Icons.check_rounded
                            : Icons.send_rounded)
                        : Icons.mic_rounded,
                    color: scheme.onPrimary,
                    size: 22,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRecordingBar() {
    final scheme = Theme.of(context).colorScheme;
    String two(int n) => n.toString().padLeft(2, '0');
    final mins = _recordElapsed.inMinutes;
    final secs = _recordElapsed.inSeconds.remainder(60);
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(
              top: BorderSide(
                  color: scheme.outlineVariant.withValues(alpha: 0.4))),
        ),
        child: Row(
          children: [
            const _RecDot(),
            const SizedBox(width: 12),
            Text('Aufnahme … ${two(mins)}:${two(secs)}',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const Spacer(),
            TextButton(
              onPressed: _cancelRecording,
              child: const Text('Abbrechen'),
            ),
            const SizedBox(width: 4),
            Material(
              color: scheme.primary,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _stopAndSendRecording,
                child: const Padding(
                  padding: EdgeInsets.all(12),
                  child: Icon(Icons.send_rounded, color: Colors.white, size: 22),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

class _ListItem {
  final Message? message;
  final DateTime? time;
  final bool isUnread;
  _ListItem.message(this.message)
      : time = null,
        isUnread = false;
  _ListItem.divider(this.time)
      : message = null,
        isUnread = false;
  _ListItem.unread()
      : message = null,
        time = null,
        isUnread = true;
  bool get isDivider => message == null && time != null;
}

/// The "X neue Nachrichten" marker shown above the first unread message when a
/// chat is opened with pending messages.
class _UnreadDivider extends StatelessWidget {
  final int count;
  const _UnreadDivider({required this.count});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Row(
        children: [
          Expanded(child: Divider(color: scheme.primary.withValues(alpha: 0.4))),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 10),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              count == 1 ? '1 neue Nachricht' : '$count neue Nachrichten',
              style: TextStyle(
                color: scheme.primary,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(child: Divider(color: scheme.primary.withValues(alpha: 0.4))),
        ],
      ),
    );
  }
}

class _DayDivider extends StatelessWidget {
  final String label;
  const _DayDivider({required this.label});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: scheme.onSurfaceVariant,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _TypingRow extends StatelessWidget {
  final Chat chat;
  const _TypingRow({required this.chat});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final typing = state.typingIn(chat.id).where((id) => id != state.me?.id);
    if (typing.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final name = chat.isGroup && typing.length == 1
        ? '${state.cachedUser(typing.first)?.displayName.split(' ').first ?? 'Jemand'} schreibt'
        : 'schreibt';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 0, 16, 6),
      child: Row(
        children: [
          const _TypingDots(),
          const SizedBox(width: 8),
          Text(
            chat.isGroup ? name : 'tippt gerade …',
            style: TextStyle(
                color: scheme.onSurfaceVariant,
                fontSize: 12.5,
                fontStyle: FontStyle.italic),
          ),
        ],
      ),
    );
  }
}

class _TypingDots extends StatefulWidget {
  const _TypingDots();
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))
        ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return SizedBox(
      width: 28,
      height: 10,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(3, (i) {
              final t = (_c.value + i * 0.2) % 1.0;
              final scale = 0.6 + 0.4 * (1 - (t - 0.5).abs() * 2).clamp(0, 1);
              return Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: scale.toDouble()),
                  shape: BoxShape.circle,
                ),
              );
            }),
          );
        },
      ),
    );
  }
}

class _AttachOption extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;
  const _AttachOption({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: SizedBox(
        width: 76,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.16),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 28),
            ),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(fontSize: 12.5)),
          ],
        ),
      ),
    );
  }
}

class _BlockedBar extends StatelessWidget {
  final String name;
  final VoidCallback onUnblock;
  const _BlockedBar({required this.name, required this.onUnblock});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 14, 12, 14),
        color: scheme.surfaceContainerHigh,
        child: Row(
          children: [
            Icon(Icons.block_rounded, color: scheme.error, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Du hast diese Person blockiert.',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ),
            TextButton(onPressed: onUnblock, child: const Text('Entsperren')),
          ],
        ),
      ),
    );
  }
}

/// Shown instead of the composer in a read-only channel (an official "Ping
/// Team" broadcast): you receive messages here but can't reply. Styled to read
/// as a trusted, official surface rather than just a greyed-out bar.
/// A thin tappable bar above the composer summarising "send later" messages
/// queued for this chat. Tapping it opens the management sheet.
class _ScheduledBar extends StatelessWidget {
  final List<ScheduledMessage> items;
  final VoidCallback onTap;
  const _ScheduledBar({required this.items, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final next = items.first;
    return Material(
      color: scheme.secondaryContainer,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 12, 8),
          child: Row(
            children: [
              Icon(Icons.schedule_rounded,
                  size: 18, color: scheme.onSecondaryContainer),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  items.length == 1
                      ? 'Geplant für ${TimeFormat.dateTime(next.sendTime)}'
                      : '${items.length} geplante Nachrichten · nächste ${TimeFormat.dateTime(next.sendTime)}',
                  style: TextStyle(
                      fontSize: 12.8,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSecondaryContainer),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(Icons.expand_less_rounded,
                  size: 20, color: scheme.onSecondaryContainer),
            ],
          ),
        ),
      ),
    );
  }
}

/// 0.27.0: the pinned-messages banner shown below the app bar. Tapping it jumps
/// to the current pin and cycles to the next; the trailing button unpins it.
class _PinnedBanner extends StatelessWidget {
  final List<Message> pins;
  final int index;
  final VoidCallback onTap;
  final VoidCallback onUnpin;
  const _PinnedBanner({
    required this.pins,
    required this.index,
    required this.onTap,
    required this.onUnpin,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final i = index.clamp(0, pins.length - 1);
    final m = pins[i];
    return Material(
      color: scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
          child: Row(
            children: [
              Container(width: 3, height: 30, color: scheme.primary),
              const SizedBox(width: 10),
              Icon(Icons.push_pin_rounded, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      pins.length > 1
                          ? 'Angepinnt · ${i + 1}/${pins.length}'
                          : 'Angepinnte Nachricht',
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: scheme.primary),
                    ),
                    Text(
                      m.preview,
                      style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded, size: 18),
                tooltip: 'Loslösen',
                visualDensity: VisualDensity.compact,
                color: scheme.onSurfaceVariant,
                onPressed: onUnpin,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReadOnlyBar extends StatelessWidget {
  const _ReadOnlyBar();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHigh,
          border: Border(
            top: BorderSide(
              color: scheme.primary.withValues(alpha: 0.35),
              width: 1.5,
            ),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const PingBadge(kind: BadgeKind.official, size: 20),
            const SizedBox(width: 10),
            Flexible(
              child: Text(
                'Offizielle Mitteilungen vom Ping-Team. Antworten ist nicht möglich.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: scheme.onSurfaceVariant,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecDot extends StatefulWidget {
  const _RecDot();
  @override
  State<_RecDot> createState() => _RecDotState();
}

class _RecDotState extends State<_RecDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.3, end: 1.0).animate(_c),
      child: Container(
        width: 12,
        height: 12,
        decoration: const BoxDecoration(
          color: Color(0xFFE53935),
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

class _EmptyConversation extends StatelessWidget {
  final Chat chat;
  final String? imageUrl;
  final Map<String, String>? imageHeaders;
  const _EmptyConversation(
      {required this.chat, this.imageUrl, this.imageHeaders});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PingAvatar(
              initials: chat.isGroup
                  ? chat.initials
                  : (chat.otherUser?.initials ?? chat.initials),
              color: chat.color,
              size: 84,
              icon: chat.isGroup
                  ? Icons.groups_rounded
                  : (chat.self ? Icons.bookmark_rounded : null),
              imageUrl: imageUrl,
              imageHeaders: imageHeaders,
            ),
            const SizedBox(height: 20),
            Text(
              chat.self
                  ? 'Notiz an mich'
                  : chat.isGroup
                      ? 'Das ist der Anfang von „${chat.title}"'
                      : 'Schreib ${chat.title} die erste Nachricht',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              chat.self
                  ? 'Schreib dir selbst Notizen, sichere Links und Dateien — nur du siehst sie.'
                  : 'Nachrichten sind nur für Mitglieder dieses Chats sichtbar.',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet showing, per recipient, whether and when they received and read
/// one of my messages (long-press → Info). Each recipient gets a little
/// delivered/read timeline rather than a single status line.
class _MessageInfoSheet extends StatelessWidget {
  final Future<List<MessageReceiptInfo>> future;
  final Message message;
  final AppState state;
  const _MessageInfoSheet(
      {required this.future, required this.message, required this.state});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.3,
      maxChildSize: 0.92,
      builder: (ctx, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 28),
        children: [
          Center(
            child: Text('Nachrichten-Info',
                style: Theme.of(context).textTheme.titleLarge),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              message.preview,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 15, height: 1.3),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Icon(Icons.schedule_rounded,
                  size: 17, color: scheme.onSurfaceVariant),
              const SizedBox(width: 10),
              Text(
                'Gesendet · ${TimeFormat.receiptStamp(message.createdAt)}',
                style: TextStyle(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const Divider(height: 30),
          FutureBuilder<List<MessageReceiptInfo>>(
            future: future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (snap.hasError) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('Konnte die Info nicht laden.',
                      style: TextStyle(color: scheme.error)),
                );
              }
              final receipts = snap.data ?? const <MessageReceiptInfo>[];
              if (receipts.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Noch niemand hat diese Nachricht erhalten.',
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                );
              }
              return Column(
                children: [for (final r in receipts) _recipient(context, r)],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _recipient(BuildContext context, MessageReceiptInfo r) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Row(
            children: [
              PingAvatar(
                initials: r.user.initials,
                color: r.user.color,
                size: 40,
                imageUrl: state.avatarUrl(r.user),
                imageHeaders: state.authHeaders,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  r.user.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 15.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _timelineRow(
            context,
            label: 'Zugestellt',
            time: r.deliveredAt,
            active: r.delivered,
            blue: false,
          ),
          const SizedBox(height: 8),
          _timelineRow(
            context,
            label: 'Gelesen',
            time: r.readAt,
            active: r.read,
            blue: true,
          ),
        ],
      ),
    );
  }

  Widget _timelineRow(
    BuildContext context, {
    required String label,
    required int? time,
    required bool active,
    required bool blue,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final color = !active
        ? scheme.onSurfaceVariant.withValues(alpha: 0.45)
        : (blue ? scheme.primary : scheme.onSurfaceVariant);
    return Row(
      children: [
        Icon(Icons.done_all_rounded, size: 18, color: color),
        const SizedBox(width: 10),
        Text(
          label,
          style: TextStyle(
            color: active ? null : scheme.onSurfaceVariant.withValues(alpha: 0.6),
            fontWeight: FontWeight.w600,
          ),
        ),
        const Spacer(),
        Text(
          active ? TimeFormat.receiptStamp(time) : 'Noch nicht',
          style: TextStyle(
            color: active ? color : scheme.onSurfaceVariant.withValues(alpha: 0.6),
            fontSize: 13,
          ),
        ),
      ],
    );
  }
}

/// What the poll composer hands back to the chat screen for sending.
class _PollDraft {
  final String question;
  final List<String> options;
  final bool multi;
  const _PollDraft(this.question, this.options, this.multi);
}

/// Bottom sheet to compose a poll: question, 2-12 answer options (rows appear
/// as you fill them) and a multi-choice switch.
class _PollComposerSheet extends StatefulWidget {
  const _PollComposerSheet();

  @override
  State<_PollComposerSheet> createState() => _PollComposerSheetState();
}

class _PollComposerSheetState extends State<_PollComposerSheet> {
  final _question = TextEditingController();
  final List<TextEditingController> _options = [
    TextEditingController(),
    TextEditingController(),
  ];
  bool _multi = false;

  static const _maxOptions = 12;

  @override
  void dispose() {
    _question.dispose();
    for (final c in _options) {
      c.dispose();
    }
    super.dispose();
  }

  List<String> get _filledOptions => _options
      .map((c) => c.text.trim())
      .where((t) => t.isNotEmpty)
      .toList();

  bool get _canSend =>
      _question.text.trim().isNotEmpty && _filledOptions.length >= 2;

  void _onOptionChanged() {
    // Always keep one empty row at the end (until the cap is reached).
    if (_options.length < _maxOptions &&
        _options.every((c) => c.text.trim().isNotEmpty)) {
      _options.add(TextEditingController());
    }
    setState(() {});
  }

  void _removeOption(int i) {
    if (_options.length <= 2) return;
    _options.removeAt(i).dispose();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final inset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: inset),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        minChildSize: 0.4,
        maxChildSize: 0.95,
        builder: (ctx, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          children: [
            Row(
              children: [
                Icon(Icons.poll_rounded, color: scheme.primary),
                const SizedBox(width: 10),
                Text('Umfrage erstellen',
                    style: Theme.of(context).textTheme.titleLarge),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _question,
              maxLength: 300,
              minLines: 1,
              maxLines: 3,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Frage',
                hintText: 'Was möchtest du fragen?',
                counterText: '',
              ),
            ),
            const SizedBox(height: 10),
            Text('Antworten',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(color: scheme.onSurfaceVariant)),
            const SizedBox(height: 4),
            for (var i = 0; i < _options.length; i++)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: TextField(
                  controller: _options[i],
                  maxLength: 100,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => _onOptionChanged(),
                  decoration: InputDecoration(
                    hintText: 'Antwort ${i + 1}',
                    counterText: '',
                    isDense: true,
                    suffixIcon: _options.length > 2
                        ? IconButton(
                            icon: const Icon(Icons.close_rounded, size: 18),
                            tooltip: 'Entfernen',
                            onPressed: () => _removeOption(i),
                          )
                        : null,
                  ),
                ),
              ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mehrere Antworten erlauben'),
              subtitle:
                  const Text('Jede Person kann mehrere Optionen wählen.'),
              value: _multi,
              onChanged: (v) => setState(() => _multi = v),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _canSend
                  ? () => Navigator.pop(
                        context,
                        _PollDraft(
                            _question.text.trim(), _filledOptions, _multi),
                      )
                  : null,
              icon: const Icon(Icons.send_rounded),
              label: const Text('Umfrage senden'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Placeholder shown in the in-chat search view before a query is entered or
/// when nothing matches.
class _SearchHint extends StatelessWidget {
  final IconData icon;
  final String text;
  const _SearchHint({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: scheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// A floating "jump to latest" pill shown when the user has scrolled up.
class _ScrollDownButton extends StatelessWidget {
  final VoidCallback onTap;
  const _ScrollDownButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      elevation: 4,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(9),
          child: Icon(Icons.keyboard_arrow_down_rounded,
              color: scheme.primary, size: 28),
        ),
      ),
    );
  }
}
