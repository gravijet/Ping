import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import 'chat_screen.dart';
import 'new_group_screen.dart';

class NewChatScreen extends StatefulWidget {
  const NewChatScreen({super.key});

  @override
  State<NewChatScreen> createState() => _NewChatScreenState();
}

class _NewChatScreenState extends State<NewChatScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<PingUser> _results = [];
  bool _searching = false;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _query = value.trim();
    _debounce?.cancel();
    if (_query.length < 2) {
      setState(() {
        _results = [];
        _searching = false;
      });
      return;
    }
    setState(() => _searching = true);
    _debounce = Timer(const Duration(milliseconds: 350), _runSearch);
  }

  Future<void> _runSearch() async {
    final state = context.read<AppState>();
    try {
      final users = await state.searchUsers(_query);
      if (mounted && _query.length >= 2) {
        setState(() {
          _results = users;
          _searching = false;
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _searching = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _openChat(PingUser user) async {
    final state = context.read<AppState>();
    try {
      final chat = await state.openDirectChat(user);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Neuer Chat')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: TextField(
              controller: _search,
              autofocus: true,
              onChanged: _onChanged,
              decoration: InputDecoration(
                hintText: 'Benutzername suchen …',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          _search.clear();
                          _onChanged('');
                        },
                      ),
              ),
            ),
          ),
          ListTile(
            leading: CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              child: Icon(Icons.group_add_rounded,
                  color: scheme.onPrimaryContainer),
            ),
            title: const Text('Neue Gruppe',
                style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: const Text('Mehrere Leute in einem Chat'),
            onTap: () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (_) => const NewGroupScreen()),
            ),
          ),
          const Divider(height: 1),
          Expanded(child: _buildResults(scheme)),
        ],
      ),
    );
  }

  Widget _buildResults(ColorScheme scheme) {
    if (_searching) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_query.length < 2) {
      return _hint(
        scheme,
        Icons.person_search_rounded,
        'Jemanden finden',
        'Gib mindestens zwei Zeichen eines Benutzernamens ein, um Leute zu '
            'finden und einen Chat zu starten.',
      );
    }
    if (_results.isEmpty) {
      return _hint(
        scheme,
        Icons.search_off_rounded,
        'Niemanden gefunden',
        'Zu „$_query" gibt es keinen Treffer. Prüf die Schreibweise oder '
            'frag nach dem genauen Benutzernamen.',
      );
    }
    return ListView.builder(
      itemCount: _results.length,
      itemBuilder: (context, i) {
        final u = _results[i];
        return ListTile(
          leading: PingAvatar(
              initials: u.initials, color: u.color, size: 46, online: u.online),
          title: Text(u.displayName,
              style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text('@${u.username}'),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () => _openChat(u),
        );
      },
    );
  }

  Widget _hint(
      ColorScheme scheme, IconData icon, String title, String body) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 72, color: scheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
