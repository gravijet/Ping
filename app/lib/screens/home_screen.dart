import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../models/remote_config.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/notification_target.dart';
import '../utils/chat_filter.dart';
import '../models/chat_folder.dart';
import '../widgets/brand.dart';
import '../widgets/changelog_view.dart';
import '../widgets/chat_tile.dart';
import '../widgets/skeleton.dart';
import '../widgets/update_sheet.dart';
import '../widgets/verified_badge.dart';
import 'app_navigation.dart';
import 'archived_chats_screen.dart';
import 'calls_tab.dart';
import 'chat_screen.dart';
import 'new_chat_screen.dart';
import 'reminders_screen.dart';
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
  late final AppState _state = context.read<AppState>();
  late final TabController _tabs = TabController(
    length: 3,
    vsync: this,
    // Open on the user's preferred start tab (Chats/Status/Anrufe).
    initialIndex: _state.settings.startTab.clamp(0, 2),
  );
  bool _loading = true;
  String? _error;
  String _chatQuery = '';
  ChatFilter _filter = ChatFilter.all;
  // 0.27.0: the active user folder ("Arbeit", …), or null for no folder filter.
  String? _folderFilter;

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
    _tabs.addListener(() {
      setState(() {});
      // Opening the Anrufe tab clears its missed-call badge.
      if (_tabs.index == 2) _state.markCallsSeen();
    });
    // Starting directly on the Anrufe tab should clear its badge too.
    if (_tabs.index == 2) state.markCallsSeen();
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
        icon: const PingBadge(kind: BadgeKind.official, size: 40, glow: true),
        title: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Offizielle Mitteilung',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.4,
                color: Theme.of(ctx).colorScheme.primary,
              ),
            ),
            const SizedBox(height: 4),
            Text(title, textAlign: TextAlign.center),
          ],
        ),
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
    } else if (target.route == 'calls') {
      _tabs.animateTo(2);
    } else if (target.route == 'status') {
      _tabs.animateTo(1);
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
  bool _whatsNewShown = false;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final onStatus = _tabs.index == 1;
    final onCalls = _tabs.index == 2;

    // Proactively offer a freshly-detected update once (per version).
    if (state.updateAutoPromptPending && !_autoUpdateShown) {
      _autoUpdateShown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        state.markUpdatePrompted(); // persist in the background
        showUpdateSheet(context);
      });
    }

    // After an update was installed, show the changelog for the new version once.
    if (state.whatsNewVersion != null &&
        !_whatsNewShown &&
        !state.updateAutoPromptPending) {
      _whatsNewShown = true;
      final version = state.whatsNewVersion!;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        state.clearWhatsNew(); // persist in the background
        showWhatsNewSheet(context, version: version);
      });
    }

    // The server can mark old builds as unsupported — block the app behind a
    // mandatory-update gate rather than letting an incompatible client run.
    if (state.updateMandatory) {
      return const _ForceUpdateScreen();
    }

    return Scaffold(
      appBar: pingAppBar(
        context,
        titleSpacing: 16,
        title: const Text('Ping'),
        actions: [
          if (state.feature('reminders', fallback: true))
            IconButton(
              tooltip: 'Erinnerungen',
              icon: Badge(
                isLabelVisible: state.pendingReminderCount > 0,
                label: Text('${state.pendingReminderCount}'),
                child: const Icon(Icons.alarm_outlined),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const RemindersScreen()),
              ),
            ),
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
              child: _TabLabel(
                text: 'Status',
                badge: state.statusUnseen,
                scheme: scheme,
              ),
            ),
            Tab(
              child: _TabLabel(
                text: 'Anrufe',
                badge: state.missedCallCount,
                scheme: scheme,
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
          : onCalls
              ? PingGradientFab(
                  heroTag: 'fab',
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const NewChatScreen()),
                  ),
                  icon: Icons.add_ic_call_rounded,
                  label: 'Anruf',
                )
              : PingGradientFab(
                  heroTag: 'fab',
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const NewChatScreen()),
                  ),
                  icon: Icons.edit_rounded,
                  label: 'Neuer Chat',
                ),
      body: Column(
        children: [
          if (!state.online) _OfflineBanner(state: state),
          if (state.serverNotice != null) _NoticeBanner(notice: state.serverNotice!),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                RefreshIndicator(
                    onRefresh: _refresh, child: _chatsBody(state, scheme)),
                const StatusTab(),
                const CallsTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openSettings() => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const SettingsScreen()),
      );

  // ---- Chat folders (0.27.0) -----------------------------------------------

  void _folderError(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(e is ApiException ? e.message : 'Aktion fehlgeschlagen.'),
    ));
  }

  Future<void> _manageFolders() async {
    final state = context.read<AppState>();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetCtx) => AnimatedBuilder(
        animation: state,
        builder: (ctx, _) {
          final folders = state.folders;
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                    child: Text('Ordner',
                        style: Theme.of(ctx).textTheme.titleLarge),
                  ),
                  if (folders.isEmpty)
                    const Padding(
                      padding: EdgeInsets.fromLTRB(12, 8, 12, 20),
                      child: Text(
                        'Noch keine Ordner. Lege einen an, um deine Chats zu '
                        'gruppieren.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  for (final f in folders)
                    ListTile(
                      leading: Text(f.emoji.isNotEmpty ? f.emoji : '🗂️',
                          style: const TextStyle(fontSize: 22)),
                      title: Text(f.name),
                      subtitle: Text(
                          '${f.chatIds.length} ${f.chatIds.length == 1 ? 'Chat' : 'Chats'}'),
                      onTap: () => _assignFolderChats(f),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline_rounded),
                        tooltip: 'Löschen',
                        onPressed: () async {
                          try {
                            await state.deleteFolder(f.id);
                          } catch (e) {
                            _folderError(e);
                          }
                        },
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                    child: FilledButton.icon(
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Neuen Ordner anlegen'),
                      onPressed:
                          folders.length >= 20 ? null : _createFolderDialog,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _createFolderDialog() async {
    final state = context.read<AppState>();
    final nameCtrl = TextEditingController();
    final emojiCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Neuer Ordner'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: emojiCtrl,
              maxLength: 8,
              decoration: const InputDecoration(
                  labelText: 'Symbol (optional)', counterText: ''),
            ),
            TextField(
              controller: nameCtrl,
              maxLength: 40,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Anlegen')),
        ],
      ),
    );
    if (ok == true && nameCtrl.text.trim().isNotEmpty) {
      try {
        await state.createFolder(nameCtrl.text.trim(),
            emoji: emojiCtrl.text.trim());
      } catch (e) {
        _folderError(e);
      }
    }
  }

  Future<void> _assignFolderChats(ChatFolder folder) async {
    final state = context.read<AppState>();
    final selected = {...folder.chatIds};
    final chats = state.chats.where((c) => !c.archived).toList();
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text('„${folder.name}" · Chats',
                    style: Theme.of(ctx).textTheme.titleMedium),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final c in chats)
                      CheckboxListTile(
                        value: selected.contains(c.id),
                        title: Text(c.displayTitle,
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        onChanged: (v) => setSheet(() {
                          if (v == true) {
                            selected.add(c.id);
                          } else {
                            selected.remove(c.id);
                          }
                        }),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Speichern'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (saved == true) {
      try {
        await state.setFolderChats(folder.id, selected.toList());
      } catch (e) {
        _folderError(e);
      }
    }
  }

  String _emptyFilterText() => switch (_filter) {
        ChatFilter.unread => 'Keine ungelesenen Chats',
        ChatFilter.favorites => 'Noch keine Favoriten — tippe einen Chat lang '
            'an und wähle „Favorit".',
        ChatFilter.groups => 'Keine Gruppen',
        ChatFilter.all => 'Keine Chats gefunden',
      };

  Widget _chatsBody(AppState state, ColorScheme scheme) {
    if (_loading && state.chats.isEmpty) {
      // A shaped skeleton reads as "your chats are loading" far better than a
      // bare spinner; it honours the reduce-motion preference by going static.
      return ChatListSkeleton(animate: !state.settings.reduceMotion);
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
    // The quick filter (Alle/Ungelesen/Favoriten/Gruppen) only applies when not
    // searching — a search always looks across everything.
    var filtered = (searching || _filter == ChatFilter.all)
        ? source
        : applyChatFilter(source, _filter, isFavorite: state.isFavorite);
    // 0.27.0: narrow to the selected folder (cleared automatically if the folder
    // was deleted on another device).
    if (!searching && _folderFilter != null) {
      ChatFolder? folder;
      for (final f in state.folders) {
        if (f.id == _folderFilter) {
          folder = f;
          break;
        }
      }
      if (folder == null) {
        _folderFilter = null;
      } else {
        filtered = filtered.where((c) => folder!.contains(c.id)).toList();
      }
    }
    final chats = !searching
        ? filtered
        : filtered
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
        if (!searching)
          _FilterBar(
            current: _filter,
            unreadCount: state.chats
                .where((c) => !c.archived && c.unread > 0)
                .length,
            favoriteCount: state.favoriteCount,
            folders: state.folders,
            selectedFolderId: _folderFilter,
            onSelect: (f) {
              state.feedback.tap();
              setState(() {
                _filter = f;
                _folderFilter = null; // built-in filters and folders are exclusive
              });
            },
            onSelectFolder: (id) {
              state.feedback.tap();
              setState(() {
                _folderFilter = id;
                _filter = ChatFilter.all;
              });
            },
            onManageFolders: _manageFolders,
          ),
        Expanded(
          child: (chats.isEmpty && !searching)
              ? Center(
                  child: Text(_emptyFilterText(),
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
                      _swipeableTile(state, scheme, chat),
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

  /// A chat row with swipe gestures: right = pin/unpin, left = archive. The
  /// row always springs back (confirmDismiss returns false) — the action runs,
  /// nothing is removed destructively.
  Widget _swipeableTile(AppState state, ColorScheme scheme, Chat chat) {
    final pinned = state.isPinned(chat.id);
    final canArchive = !chat.self;
    // The right-swipe action is user-configurable. "Stummschalten" makes no
    // sense for the note-to-self chat, so it falls back to "Anheften" there.
    var rightAction = state.settings.swipeRightAction;
    if (chat.self && rightAction == 'mute') rightAction = 'pin';

    final DismissDirection direction;
    if (rightAction == 'none') {
      direction =
          canArchive ? DismissDirection.endToStart : DismissDirection.none;
    } else {
      direction = canArchive
          ? DismissDirection.horizontal
          : DismissDirection.startToEnd;
    }

    final ({Color color, IconData icon, String label}) right = switch (rightAction) {
      'mute' => (
          color: scheme.secondary,
          icon: chat.muted
              ? Icons.notifications_active_rounded
              : Icons.notifications_off_rounded,
          label: chat.muted ? 'Lauf' : 'Stumm',
        ),
      _ => (
          color: scheme.primary,
          icon: pinned ? Icons.push_pin_outlined : Icons.push_pin_rounded,
          label: pinned ? 'Lösen' : 'Anheften',
        ),
    };

    return Dismissible(
      key: ValueKey('chat-${chat.id}'),
      direction: direction,
      background: _swipeBackground(
        scheme,
        alignment: Alignment.centerLeft,
        color: right.color,
        icon: right.icon,
        label: right.label,
      ),
      secondaryBackground: _swipeBackground(
        scheme,
        alignment: Alignment.centerRight,
        color: scheme.tertiary,
        icon: chat.archived ? Icons.unarchive_rounded : Icons.archive_rounded,
        label: chat.archived ? 'Zurückholen' : 'Archivieren',
      ),
      confirmDismiss: (dir) async {
        state.feedback.impact();
        if (dir == DismissDirection.startToEnd) {
          if (rightAction == 'mute') {
            try {
              await state.toggleMute(chat.id, !chat.muted);
            } on ApiException catch (e) {
              if (mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(e.message)));
              }
            }
          } else {
            state.togglePin(chat.id);
          }
        } else {
          try {
            await state.toggleArchive(chat.id, !chat.archived);
          } on ApiException catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context)
                  .showSnackBar(SnackBar(content: Text(e.message)));
            }
          }
        }
        return false; // spring back — the tile stays in place
      },
      child: ChatTile(
        chat: chat,
        pinned: pinned,
        onTap: () => _openChatById(chat.id),
        onLongPress: () => _showChatMenu(chat),
      ),
    );
  }

  Widget _swipeBackground(
    ColorScheme scheme, {
    required Alignment alignment,
    required Color color,
    required IconData icon,
    required String label,
  }) {
    return Container(
      color: color.withValues(alpha: 0.18),
      padding: const EdgeInsets.symmetric(horizontal: 24),
      alignment: alignment,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color),
          const SizedBox(height: 2),
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 11.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  void _showChatMenu(Chat chat) {
    final state = context.read<AppState>();
    state.feedback.impact();
    final pinned = state.isPinned(chat.id);
    final favorite = state.isFavorite(chat.id);
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
            ListTile(
              leading: Icon(
                  favorite ? Icons.star_rounded : Icons.star_border_rounded,
                  color: favorite ? const Color(0xFFFFB300) : null),
              title: Text(favorite ? 'Aus Favoriten entfernen' : 'Favorit'),
              onTap: () {
                Navigator.pop(ctx);
                state.toggleFavorite(chat.id);
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

/// The quick-filter chip row above the chat list (Alle/Ungelesen/Favoriten/
/// Gruppen). Horizontally scrollable so it never overflows on small screens.
class _FilterBar extends StatelessWidget {
  final ChatFilter current;
  final int unreadCount;
  final int favoriteCount;
  final ValueChanged<ChatFilter> onSelect;
  // 0.27.0: user folders rendered as extra chips after the built-in filters.
  final List<ChatFolder> folders;
  final String? selectedFolderId;
  final ValueChanged<String> onSelectFolder;
  final VoidCallback onManageFolders;
  const _FilterBar({
    required this.current,
    required this.unreadCount,
    required this.favoriteCount,
    required this.onSelect,
    required this.folders,
    required this.selectedFolderId,
    required this.onSelectFolder,
    required this.onManageFolders,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final folderActive = selectedFolderId != null;
    int? badgeFor(ChatFilter f) => switch (f) {
          ChatFilter.unread => unreadCount > 0 ? unreadCount : null,
          ChatFilter.favorites => favoriteCount > 0 ? favoriteCount : null,
          _ => null,
        };
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          for (final f in ChatFilter.values)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(f.label),
                    if (badgeFor(f) != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: scheme.primary,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        child: Text('${badgeFor(f)}',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: scheme.onPrimary,
                            )),
                      ),
                    ],
                  ],
                ),
                selected: !folderActive && current == f,
                showCheckmark: false,
                onSelected: (_) => onSelect(f),
              ),
            ),
          for (final folder in folders)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(folder.emoji.isNotEmpty
                    ? '${folder.emoji} ${folder.name}'
                    : folder.name),
                selected: selectedFolderId == folder.id,
                showCheckmark: false,
                onSelected: (_) => onSelectFolder(folder.id),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ActionChip(
              avatar: const Icon(Icons.create_new_folder_outlined, size: 18),
              label: const Text('Ordner'),
              onPressed: onManageFolders,
            ),
          ),
        ],
      ),
    );
  }
}

/// A tab title with an optional count pill (unseen status / missed calls).
class _TabLabel extends StatelessWidget {
  final String text;
  final int badge;
  final ColorScheme scheme;
  const _TabLabel(
      {required this.text, required this.badge, required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(text),
        if (badge > 0) ...[
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              '$badge',
              style: TextStyle(
                  color: scheme.primary,
                  fontSize: 11,
                  fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ],
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

/// A slim bar shown while the device is offline. Reflects the outbox so the user
/// knows their messages aren't lost — they'll go out automatically on reconnect.
class _OfflineBanner extends StatelessWidget {
  final AppState state;
  const _OfflineBanner({required this.state});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final pending = state.pendingOutbox;
    return Material(
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Row(
          children: [
            Icon(Icons.cloud_off_rounded, size: 18, color: scheme.onSurfaceVariant),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                pending > 0
                    ? 'Offline · $pending Nachricht${pending == 1 ? '' : 'en'} wird gesendet, sobald du wieder verbunden bist'
                    : 'Offline · du siehst gespeicherte Inhalte',
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurfaceVariant),
              ),
            ),
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
            ),
          ],
        ),
      ),
    );
  }
}

/// A server-pushed notice banner (remote config). Colour + icon reflect the
/// level so a "critical" outage notice reads differently from a feature tip.
class _NoticeBanner extends StatelessWidget {
  final RemoteNotice notice;
  const _NoticeBanner({required this.notice});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg, icon) = switch (notice.level) {
      'critical' => (
          scheme.errorContainer,
          scheme.onErrorContainer,
          Icons.error_outline_rounded
        ),
      'warning' => (
          scheme.tertiaryContainer,
          scheme.onTertiaryContainer,
          Icons.warning_amber_rounded
        ),
      _ => (
          scheme.secondaryContainer,
          scheme.onSecondaryContainer,
          Icons.campaign_rounded
        ),
    };
    return Material(
      color: bg,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 9, 16, 9),
        child: Row(
          children: [
            Icon(icon, size: 18, color: fg),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                notice.text,
                style: TextStyle(
                    fontSize: 12.8, fontWeight: FontWeight.w600, color: fg),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Full-screen blocking gate shown when the server marks the running build as
/// unsupported (remote config `minSupportedBuild`). The only way forward is the
/// in-app update.
class _ForceUpdateScreen extends StatelessWidget {
  const _ForceUpdateScreen();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.system_update_rounded, size: 72, color: scheme.primary),
              const SizedBox(height: 18),
              Text('Update erforderlich',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center),
              const SizedBox(height: 10),
              Text(
                'Diese Version von Ping wird nicht mehr unterstützt. '
                'Bitte aktualisiere, um weiter zu chatten.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => showUpdateSheet(context),
                icon: const Icon(Icons.download_rounded),
                label: const Text('Jetzt aktualisieren'),
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
