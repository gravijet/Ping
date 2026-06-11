import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/notification_target.dart';
import '../widgets/brand.dart';
import '../widgets/chat_tile.dart';
import '../widgets/update_sheet.dart';
import 'app_navigation.dart';
import 'archived_chats_screen.dart';
import 'chat_screen.dart';
import 'new_chat_screen.dart';
import 'saved_messages_screen.dart';
import 'settings_screen.dart';
import 'status_tab.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  late final AppState _state = context.read<AppState>();
  bool _loading = true;
  String? _error;
  String _chatQuery = '';

  // Global message search (server-side, across the full history).
  Timer? _searchDebounce;
  List<Message> _messageHits = const [];
  bool _searchingMessages = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    final state = _state;
    // Route notification taps (chat or admin deep-link) to the right screen.
    state.onOpenTarget = _handleNotificationTarget;
    // Surface admin announcements while the app is open.
    state.onAnnouncement = _showAnnouncement;
    // Consume any notification that was tapped before the UI was ready (e.g. a
    // cold launch from the system tray).
    final pending = state.takePendingTarget();
    if (pending != null) {
      WidgetsBinding.instance.addPostFrameCallback(
          (_) => _handleNotificationTarget(pending));
    }
    _tabs.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    if (_state.onOpenTarget == _handleNotificationTarget) {
      _state.onOpenTarget = null;
    }
    _searchDebounce?.cancel();
    _tabs.dispose();
    super.dispose();
  }

  /// Debounced server-side search through the whole message history. Results
  /// land in [_messageHits] and render below the chat matches.
  void _onSearchChanged(String value) {
    setState(() => _chatQuery = value);
    _searchDebounce?.cancel();
    final q = value.trim();
    if (q.length < 2) {
      setState(() {
        _messageHits = const [];
        _searchingMessages = false;
      });
      return;
    }
    setState(() => _searchingMessages = true);
    _searchDebounce = Timer(const Duration(milliseconds: 350), () async {
      try {
        final hits = await context.read<AppState>().searchAllMessages(q);
        if (mounted && _chatQuery.trim() == q) {
          setState(() {
            _messageHits = hits;
            _searchingMessages = false;
          });
        }
      } catch (_) {
        if (mounted) setState(() => _searchingMessages = false);
      }
    });
  }

  Future<void> _refresh() async {
    setState(() => _error = null);
    try {
      final state = context.read<AppState>();
      await state.loadChats();
      await state.loadStatus();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showAnnouncement(String title, String body, String? route) {
    if (!mounted) return;
    final hasTarget = route != null && route.isNotEmpty && route != 'home';
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.campaign_rounded),
        title: Text(title),
        content: Text(body),
        actions: [
          if (hasTarget)
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Später'),
            ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              if (hasTarget) navigateToAppRoute(context, route);
            },
            child: Text(hasTarget ? 'Öffnen' : 'OK'),
          ),
        ],
      ),
    );
  }

  /// Route a tapped notification to its destination: a chat, or an in-app screen
  /// (admin deep-links). Pops back to the inbox first so we don't stack screens.
  void _handleNotificationTarget(NotificationTarget target) {
    if (!mounted) return;
    if (target.isChat) {
      _openChatById(target.chatId!);
    } else if (target.route != null) {
      navigateToAppRoute(context, target.route!);
    }
  }

  void _openChatById(String chatId) {
    final state = context.read<AppState>();
    final i = state.chats.indexWhere((c) => c.id == chatId);
    if (i != -1) _openChat(i);
  }

  void _openChat(int index) {
    final chat = context.read<AppState>().chats[index];
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)),
    );
  }

  bool _autoUpdateShown = false;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final onStatus = _tabs.index == 1;

    // Proactively offer a freshly-detected update once (per version).
    if (state.updateAutoPromptPending && !_autoUpdateShown) {
      _autoUpdateShown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        state.markUpdatePrompted(); // persist in the background
        showUpdateSheet(context);
      });
    }

    return Scaffold(
      appBar: pingAppBar(
        context,
        titleSpacing: 16,
        title: const Text('Ping'),
        actions: [
          IconButton(
            tooltip: 'Gespeichert',
            icon: const Icon(Icons.bookmark_border_rounded),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SavedMessagesScreen()),
            ),
          ),
          IconButton(
            tooltip: 'Einstellungen',
            icon: const Icon(Icons.settings_outlined),
            onPressed: _openSettings,
          ),
          const SizedBox(width: 4),
        ],
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            const Tab(text: 'Chats'),
            Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Status'),
                  if (state.statusUnseen > 0) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${state.statusUnseen}',
                        style: TextStyle(
                            color: scheme.primary,
                            fontSize: 11,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: onStatus
          ? PingGradientFab(
              heroTag: 'fab',
              onPressed: () => showAddStatusSheet(context),
              icon: Icons.add_a_photo_rounded,
            )
          : PingGradientFab(
              heroTag: 'fab',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NewChatScreen()),
              ),
              icon: Icons.edit_rounded,
              label: 'Neuer Chat',
            ),
      body: TabBarView(
        controller: _tabs,
        children: [
          RefreshIndicator(onRefresh: _refresh, child: _chatsBody(state, scheme)),
          const StatusTab(),
        ],
      ),
    );
  }

  void _openSettings() => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const SettingsScreen()),
      );

  Widget _chatsBody(AppState state, ColorScheme scheme) {
    if (_loading && state.chats.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && state.chats.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _refresh);
    }
    if (state.chats.isEmpty) {
      return const _EmptyState();
    }

    final q = _chatQuery.trim().toLowerCase();
    final searching = q.isNotEmpty;
    // While searching, archived chats take part too; otherwise they collapse
    // into the "Archiviert" entry below the search field.
    final source =
        searching ? state.chats : state.chats.where((c) => !c.archived).toList();
    final chats = !searching
        ? source
        : source
            .where((c) =>
                c.displayTitle.toLowerCase().contains(q) ||
                (c.lastMessage?.body.toLowerCase().contains(q) ?? false))
            .toList();
    final archivedCount = state.archivedCount;

    return Column(
      children: [
        if (state.availableUpdate != null) _UpdateBanner(state: state),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            onChanged: _onSearchChanged,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search_rounded),
              hintText: 'Chats und Nachrichten durchsuchen',
              isDense: true,
            ),
          ),
        ),
        Expanded(
          child: (chats.isEmpty && !searching)
              ? Center(
                  child: Text('Keine Chats gefunden',
                      style: TextStyle(color: scheme.onSurfaceVariant)),
                )
              : ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(bottom: 96, top: 2),
                  children: [
                    if (!searching && archivedCount > 0)
                      ListTile(
                        leading: const Icon(Icons.archive_outlined),
                        title: const Text('Archiviert'),
                        trailing: Text('$archivedCount',
                            style:
                                TextStyle(color: scheme.onSurfaceVariant)),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) => const ArchivedChatsScreen()),
                        ),
                      ),
                    for (final chat in chats) ...[
                      ChatTile(
                        chat: chat,
                        pinned: state.isPinned(chat.id),
                        onTap: () => _openChatById(chat.id),
                        onLongPress: () => _showChatMenu(chat),
                      ),
                      Divider(
                        indent: 84,
                        endIndent: 16,
                        color: scheme.outlineVariant.withValues(alpha: 0.3),
                      ),
                    ],
                    if (searching && chats.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(20),
                        child: Center(
                          child: Text('Keine Chats gefunden',
                              style:
                                  TextStyle(color: scheme.onSurfaceVariant)),
                        ),
                      ),
                    if (searching) ..._messageResults(state, scheme),
                  ],
                ),
        ),
      ],
    );
  }

  /// The "Nachrichten" section under the chat matches: full-history hits from
  /// the server-side search.
  List<Widget> _messageResults(AppState state, ColorScheme scheme) {
    if (!_searchingMessages && _messageHits.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
        child: Row(
          children: [
            Text('Nachrichten',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(color: scheme.onSurfaceVariant)),
            const SizedBox(width: 10),
            if (_searchingMessages)
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
      ),
      for (final m in _messageHits)
        Builder(builder: (context) {
          final chatIndex = state.chats.indexWhere((c) => c.id == m.chatId);
          final chat = chatIndex == -1 ? null : state.chats[chatIndex];
          return ListTile(
            leading: CircleAvatar(
              radius: 20,
              backgroundColor: scheme.surfaceContainerHighest,
              child: Icon(Icons.chat_bubble_outline_rounded,
                  size: 20, color: scheme.onSurfaceVariant),
            ),
            title: Text(chat?.displayTitle ?? 'Chat',
                maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(m.preview,
                maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: Text(
              _hitDate(m.createdAt),
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            onTap: chat == null ? null : () => _openChatById(chat.id),
          );
        }),
    ];
  }

  static String _hitDate(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    if (d.year == now.year && d.month == now.month && d.day == now.day) {
      return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    }
    return '${d.day}.${d.month}.${d.year % 100}';
  }

  void _showChatMenu(Chat chat) {
    final state = context.read<AppState>();
    final pinned = state.isPinned(chat.id);
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(pinned
                  ? Icons.push_pin_rounded
                  : Icons.push_pin_outlined),
              title: Text(pinned ? 'Nicht mehr anheften' : 'Anheften'),
              onTap: () {
                Navigator.pop(ctx);
                state.togglePin(chat.id);
              },
            ),
            if (!chat.self)
              ListTile(
                leading: Icon(chat.muted
                    ? Icons.notifications_active_rounded
                    : Icons.notifications_off_rounded),
                title: Text(
                    chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten'),
                onTap: () async {
                  Navigator.pop(ctx);
                  try {
                    await state.toggleMute(chat.id, !chat.muted);
                  } on ApiException catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(content: Text(e.message)));
                    }
                  }
                },
              ),
            if (!chat.self)
              ListTile(
                leading: Icon(chat.archived
                    ? Icons.unarchive_outlined
                    : Icons.archive_outlined),
                title: Text(chat.archived
                    ? 'Aus dem Archiv holen'
                    : 'Archivieren'),
                onTap: () async {
                  Navigator.pop(ctx);
                  try {
                    await state.toggleArchive(chat.id, !chat.archived);
                  } on ApiException catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(content: Text(e.message)));
                    }
                  }
                },
              ),
            ListTile(
              leading: const Icon(Icons.open_in_new_rounded),
              title: const Text('Öffnen'),
              onTap: () {
                Navigator.pop(ctx);
                _openChatById(chat.id);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.18),
        Icon(Icons.forum_outlined,
            size: 88, color: scheme.primary.withValues(alpha: 0.5)),
        const SizedBox(height: 20),
        Text(
          'Noch keine Chats',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 48),
          child: Text(
            'Tipp unten auf „Neuer Chat", schreib einer Telefonnummer oder '
            'such jemanden und leg los.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
          ),
        ),
      ],
    );
  }
}

/// A slim banner offering the in-app update when a newer build is available.
class _UpdateBanner extends StatelessWidget {
  final AppState state;
  const _UpdateBanner({required this.state});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final info = state.availableUpdate!;
    return Material(
      color: scheme.primaryContainer,
      child: InkWell(
        onTap: () => showUpdateSheet(context),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
          child: Row(
            children: [
              Icon(Icons.system_update_rounded, color: scheme.onPrimaryContainer),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Update verfügbar — Ping ${info.version}',
                        style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: scheme.onPrimaryContainer)),
                    Text('Tippen, um zu installieren',
                        style: TextStyle(
                            fontSize: 12.5,
                            color: scheme.onPrimaryContainer
                                .withValues(alpha: 0.8))),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Ausblenden',
                icon: Icon(Icons.close_rounded,
                    color: scheme.onPrimaryContainer, size: 20),
                onPressed: state.dismissUpdate,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.16),
        Icon(Icons.cloud_off_rounded, size: 80, color: scheme.error),
        const SizedBox(height: 20),
        Text(
          'Verbindung fehlgeschlagen',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 40),
          child: Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Erneut versuchen'),
          ),
        ),
      ],
    );
  }
}
