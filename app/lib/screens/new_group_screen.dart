import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import 'chat_screen.dart';

class NewGroupScreen extends StatefulWidget {
  const NewGroupScreen({super.key});

  @override
  State<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends State<NewGroupScreen> {
  final _name = TextEditingController();
  final _search = TextEditingController();
  Timer? _debounce;
  List<PingUser> _results = [];
  final Map<String, PingUser> _selected = {};
  bool _searching = false;
  bool _creating = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _name.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onSearch(String value) {
    final q = value.trim();
    _debounce?.cancel();
    if (q.length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      try {
        final users = await context.read<AppState>().searchUsers(q);
        if (mounted) {
          setState(() {
            _results = users;
            _searching = false;
          });
        }
      } on ApiException {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  void _toggle(PingUser u) {
    setState(() {
      if (_selected.containsKey(u.id)) {
        _selected.remove(u.id);
      } else {
        _selected[u.id] = u;
      }
    });
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Gib der Gruppe zuerst einen Namen.')),
      );
      return;
    }
    setState(() => _creating = true);
    try {
      final chat = await context
          .read<AppState>()
          .createGroup(name, _selected.keys.toList());
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)),
      );
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _creating = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Neue Gruppe'),
        actions: [
          TextButton(
            onPressed: _creating ? null : _create,
            child: _creating
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2))
                : const Text('Erstellen'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _name,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Gruppenname',
                hintText: 'z. B. Wochenend-Crew',
                prefixIcon: Icon(Icons.groups_rounded),
              ),
            ),
          ),
          if (_selected.isNotEmpty)
            SizedBox(
              height: 88,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: _selected.values
                    .map((u) => _SelectedChip(
                        user: u, onRemove: () => _toggle(u)))
                    .toList(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: _onSearch,
              decoration: const InputDecoration(
                hintText: 'Mitglieder suchen …',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(child: _buildResults(scheme)),
        ],
      ),
    );
  }

  Widget _buildResults(ColorScheme scheme) {
    if (_searching) return const Center(child: CircularProgressIndicator());
    if (_results.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(40),
          child: Text(
            _selected.isEmpty
                ? 'Such nach Leuten, um sie zur Gruppe hinzuzufügen. Du kannst '
                    'auch ohne Mitglieder starten und später welche einladen.'
                : 'Such nach weiteren Leuten oder tipp oben rechts auf '
                    '„Erstellen".',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),
      );
    }
    return ListView.builder(
      itemCount: _results.length,
      itemBuilder: (context, i) {
        final u = _results[i];
        final selected = _selected.containsKey(u.id);
        return ListTile(
          leading: PingAvatar(initials: u.initials, color: u.color, size: 46),
          title: Text(u.displayName,
              style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text('@${u.username}'),
          trailing: Checkbox(value: selected, onChanged: (_) => _toggle(u)),
          onTap: () => _toggle(u),
        );
      },
    );
  }
}

class _SelectedChip extends StatelessWidget {
  final PingUser user;
  final VoidCallback onRemove;
  const _SelectedChip({required this.user, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Column(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              PingAvatar(initials: user.initials, color: user.color, size: 50),
              Positioned(
                right: -4,
                top: -4,
                child: GestureDetector(
                  onTap: onRemove,
                  child: Container(
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surface,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.cancel_rounded,
                        size: 20,
                        color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          SizedBox(
            width: 56,
            child: Text(
              user.displayName.split(' ').first,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
