import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/message_bubble.dart';
import 'chat_info_screen.dart';

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
  Message? _replyTo;
  Message? _editing;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = context.read<AppState>();
    state.setActiveChat(widget.chatId);
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
    if (text.trim().isNotEmpty && !_isTyping) {
      _isTyping = true;
      state.socket.setTyping(widget.chatId, true);
    }
    _typingTimer?.cancel();
    _typingTimer = Timer(const Duration(seconds: 3), _stopTyping);
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

  Chat? get _chat {
    final chats = context.read<AppState>().chats;
    final i = chats.indexWhere((c) => c.id == widget.chatId);
    return i == -1 ? null : chats[i];
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopTyping();
    context.read<AppState>().setActiveChat(null);
    _scroll.dispose();
    _input.dispose();
    _inputFocus.dispose();
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

    return Scaffold(
      appBar: _buildAppBar(state, chat),
      body: Column(
        children: [
          Expanded(child: _buildMessageList(state, chat, messages)),
          _TypingRow(chat: chat),
          if (_replyTo != null || _editing != null) _composerBanner(),
          _buildComposer(),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(AppState state, Chat chat) {
    final scheme = Theme.of(context).colorScheme;
    final online = !chat.isGroup &&
        chat.otherUser != null &&
        state.isOnline(chat.otherUser!.id);
    final typingUsers = state.typingIn(chat.id);
    String subtitle;
    if (typingUsers.isNotEmpty) {
      subtitle = chat.isGroup
          ? (typingUsers.length == 1
              ? '${state.cachedUser(typingUsers.first)?.displayName.split(' ').first ?? 'Jemand'} tippt …'
              : 'mehrere tippen …')
          : 'tippt …';
    } else if (chat.isGroup) {
      subtitle = '${chat.memberIds.length} Mitglieder';
    } else if (online) {
      subtitle = 'online';
    } else {
      subtitle = TimeFormat.lastSeen(chat.otherUser?.lastSeen);
    }

    return AppBar(
      titleSpacing: 0,
      title: InkWell(
        onTap: () => _openInfo(chat),
        child: Row(
          children: [
            PingAvatar(
              initials: chat.initials,
              color: chat.color,
              size: 40,
              online: chat.isGroup ? null : online,
              icon: chat.isGroup ? Icons.groups_rounded : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    chat.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: typingUsers.isNotEmpty || online
                          ? scheme.primary
                          : scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.info_outline_rounded),
          tooltip: 'Chat-Infos',
          onPressed: () => _openInfo(chat),
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  void _openInfo(Chat chat) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ChatInfoScreen(chatId: chat.id)),
    );
  }

  Widget _buildMessageList(AppState state, Chat chat, List<Message> messages) {
    if (messages.isEmpty) {
      return _EmptyConversation(chat: chat);
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
        if (item.isDivider) {
          return _DayDivider(label: TimeFormat.dayDivider(item.time!));
        }
        return _buildBubble(state, chat, messages, item.message!);
      },
    );
  }

  Widget _buildBubble(
      AppState state, Chat chat, List<Message> messages, Message m) {
    final isMine = m.senderId == state.me?.id;
    final sender = m.senderId != null ? state.cachedUser(m.senderId!) : null;
    final replied = m.replyTo != null
        ? messages.where((x) => x.id == m.replyTo).cast<Message?>().firstWhere(
            (x) => true,
            orElse: () => null)
        : null;
    final repliedSender = replied?.senderId == state.me?.id
        ? 'Du'
        : state.cachedUser(replied?.senderId ?? '')?.displayName;

    return MessageBubble(
      message: m,
      isMine: isMine,
      showSenderName: chat.isGroup && !isMine,
      senderName: sender?.displayName,
      senderColor: sender?.color ?? Theme.of(context).colorScheme.primary,
      repliedTo: replied,
      repliedToSender: repliedSender,
      onLongPress: () => _showMessageActions(m, isMine),
    );
  }

  void _showMessageActions(Message m, bool isMine) {
    if (m.deleted || m.isSystem) return;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply_rounded),
              title: const Text('Antworten'),
              onTap: () {
                Navigator.pop(ctx);
                setState(() {
                  _replyTo = m;
                  _editing = null;
                });
                _inputFocus.requestFocus();
              },
            ),
            ListTile(
              leading: const Icon(Icons.copy_rounded),
              title: const Text('Kopieren'),
              onTap: () {
                Clipboard.setData(ClipboardData(text: m.body));
                Navigator.pop(ctx);
                _showError('In die Zwischenablage kopiert.');
              },
            ),
            if (isMine) ...[
              ListTile(
                leading: const Icon(Icons.edit_rounded),
                title: const Text('Bearbeiten'),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() {
                    _editing = m;
                    _replyTo = null;
                    _input.text = m.body;
                  });
                  _inputFocus.requestFocus();
                },
              ),
              ListTile(
                leading: Icon(Icons.delete_outline_rounded,
                    color: Theme.of(context).colorScheme.error),
                title: Text('Löschen',
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.error)),
                onTap: () {
                  Navigator.pop(ctx);
                  _confirmDelete(m);
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDelete(Message m) async {
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
    if (ok == true) {
      if (!mounted) return;
      try {
        await context.read<AppState>().deleteMessage(widget.chatId, m.id);
      } on ApiException catch (e) {
        _showError(e.message);
      }
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

  Widget _buildComposer() {
    final scheme = Theme.of(context).colorScheme;
    final canSend = _input.text.trim().isNotEmpty;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(
              top: BorderSide(
                  color: scheme.outlineVariant.withValues(alpha: 0.4))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _input,
                focusNode: _inputFocus,
                onChanged: _onInputChanged,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                keyboardType: TextInputType.multiline,
                decoration: InputDecoration(
                  hintText: 'Nachricht schreiben …',
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 18, vertical: 12),
                  fillColor: scheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                ),
              ),
            ),
            const SizedBox(width: 8),
            AnimatedScale(
              scale: canSend ? 1 : 0.92,
              duration: const Duration(milliseconds: 150),
              child: Material(
                color: canSend ? scheme.primary : scheme.surfaceContainerHighest,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: canSend ? _send : null,
                  child: Padding(
                    padding: const EdgeInsets.all(13),
                    child: Icon(
                      _editing != null
                          ? Icons.check_rounded
                          : Icons.send_rounded,
                      color: canSend
                          ? scheme.onPrimary
                          : scheme.onSurfaceVariant,
                      size: 22,
                    ),
                  ),
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
  _ListItem.message(this.message) : time = null;
  _ListItem.divider(this.time) : message = null;
  bool get isDivider => message == null;
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

class _EmptyConversation extends StatelessWidget {
  final Chat chat;
  const _EmptyConversation({required this.chat});

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
              initials: chat.initials,
              color: chat.color,
              size: 84,
              icon: chat.isGroup ? Icons.groups_rounded : null,
            ),
            const SizedBox(height: 20),
            Text(
              chat.isGroup
                  ? 'Das ist der Anfang von „${chat.title}"'
                  : 'Schreib ${chat.title} die erste Nachricht',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Nachrichten sind nur für Mitglieder dieses Chats sichtbar.',
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
