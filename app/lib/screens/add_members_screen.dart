import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';

/// Search for people and add them to an existing group.
class AddMembersScreen extends StatefulWidget {
  final String chatId;
  final Set<String> existingMemberIds;
  const AddMembersScreen({
    super.key,
    required this.chatId,
    required this.existingMemberIds,
  });

  @override
  State<AddMembersScreen> createState() => _AddMembersScreenState();
}

class _AddMembersScreenState extends State<AddMembersScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<PingUser> _results = [];
  final Map<String, PingUser> _selected = {};
  bool _searching = false;
  bool _saving = false;

  @override
  void dispose() {
    _debounce?.cancel();
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
            // Hide people who are already in the group.
            _results = users
                .where((u) => !widget.existingMemberIds.contains(u.id))
                .toList();
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

  Future<void> _add() async {
    if (_selected.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _saving = true);
    try {
      final added = await context
          .read<AppState>()
          .addGroupMembers(widget.chatId, _selected.keys.toList());
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(added.length == 1
              ? '${added.first.displayName} ist jetzt in der Gruppe.'
              : '${added.length} Personen hinzugefügt.'),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _saving = false);
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
        title: const Text('Mitglieder hinzufügen'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _add,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2))
                : Text(_selected.isEmpty
                    ? 'Fertig'
                    : 'Hinzufügen (${_selected.length})'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _search,
              autofocus: true,
              onChanged: _onSearch,
              decoration: const InputDecoration(
                hintText: 'Name oder Nummer suchen …',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _searching
                ? const Center(child: CircularProgressIndicator())
                : _results.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(40),
                          child: Text(
                            'Such nach Leuten, die du in die Gruppe einladen '
                            'möchtest.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _results.length,
                        itemBuilder: (context, i) {
                          final u = _results[i];
                          final selected = _selected.containsKey(u.id);
                          final state = context.read<AppState>();
                          return ListTile(
                            leading: PingAvatar(
                              initials: u.initials,
                              color: u.color,
                              size: 46,
                              imageUrl: state.avatarUrl(u),
                              imageHeaders: state.authHeaders,
                            ),
                            title: Text(u.label,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            subtitle: Text(u.hasName ? u.phone : 'Auf Ping'),
                            trailing: Checkbox(
                                value: selected, onChanged: (_) => _toggle(u)),
                            onTap: () => _toggle(u),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
