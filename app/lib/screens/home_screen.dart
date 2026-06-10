import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/brand.dart';
import '../widgets/chat_tile.dart';
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
  bool _loading = true;
  String? _error;
  String _chatQuery = '';

  @override
  void initState() {
    super.initState();
    _refresh();
    final state = context.read<AppState>();
    // Route notification taps to the right chat.
    state.notifications.onTapChat = _openChatById;
    // Surface admin announcements while the app is open.
    state.onAnnouncement = _showAnnouncement;
    _tabs.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
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

  void _showAnnouncement(String title, String body) {
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.campaign_rounded),
        title: Text(title),
        content: Text(body),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('OK'),
          ),
        ],
      ),
    );
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

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final onStatus = _tabs.index == 1;

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
    final chats = q.isEmpty
        ? state.chats
        : state.chats
            .where((c) =>
                c.displayTitle.toLowerCase().contains(q) ||
                (c.lastMessage?.body.toLowerCase().contains(q) ?? false))
            .toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            onChanged: (v) => setState(() => _chatQuery = v),
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search_rounded),
              hintText: 'Chats durchsuchen',
              isDense: true,
            ),
          ),
        ),
        Expanded(
          child: chats.isEmpty
              ? Center(
                  child: Text('Keine Chats gefunden',
                      style: TextStyle(color: scheme.onSurfaceVariant)),
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(bottom: 96, top: 2),
                  itemCount: chats.length,
                  separatorBuilder: (_, _) => Divider(
                    indent: 84,
                    endIndent: 16,
                    color: scheme.outlineVariant.withValues(alpha: 0.3),
                  ),
                  itemBuilder: (context, i) {
                    final chat = chats[i];
                    return ChatTile(
                      chat: chat,
                      pinned: state.isPinned(chat.id),
                      onTap: () => _openChatById(chat.id),
                      onLongPress: () => _showChatMenu(chat),
                    );
                  },
                ),
        ),
      ],
    );
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
