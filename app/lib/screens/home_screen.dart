import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../widgets/chat_tile.dart';
import 'chat_screen.dart';
import 'new_chat_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
    // Route notification taps to the right chat.
    context.read<AppState>().notifications.onTapChat = _openChatById;
  }

  Future<void> _refresh() async {
    setState(() {
      _error = null;
    });
    try {
      await context.read<AppState>().loadChats();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
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

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            const Text('Ping'),
            const SizedBox(width: 10),
            if (!state.socketConnected)
              _ConnectionChip(scheme: scheme),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Einstellungen',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const NewChatScreen()),
        ),
        icon: const Icon(Icons.edit_rounded),
        label: const Text('Neuer Chat'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: _buildBody(state, scheme),
      ),
    );
  }

  Widget _buildBody(AppState state, ColorScheme scheme) {
    if (_loading && state.chats.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && state.chats.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _refresh);
    }
    if (state.chats.isEmpty) {
      return const _EmptyState();
    }
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 96, top: 4),
      itemCount: state.chats.length,
      separatorBuilder: (_, _) => Divider(
        indent: 84,
        endIndent: 16,
        color: scheme.outlineVariant.withValues(alpha: 0.3),
      ),
      itemBuilder: (context, i) {
        final chat = state.chats[i];
        return ChatTile(chat: chat, onTap: () => _openChat(i));
      },
    );
  }
}

class _ConnectionChip extends StatelessWidget {
  final ColorScheme scheme;
  const _ConnectionChip({required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 11,
            height: 11,
            child: CircularProgressIndicator(
                strokeWidth: 2, color: scheme.onErrorContainer),
          ),
          const SizedBox(width: 6),
          Text(
            'verbinde …',
            style: TextStyle(
              fontSize: 12,
              color: scheme.onErrorContainer,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
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
        Icon(Icons.forum_outlined, size: 88, color: scheme.primary.withValues(alpha: 0.5)),
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
            'Tipp unten auf „Neuer Chat", such jemanden über seinen '
            'Benutzernamen und schreib die erste Nachricht.',
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
