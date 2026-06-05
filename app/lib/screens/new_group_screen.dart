import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import 'chat_screen.dart';
import 'contact_picker_screen.dart';

class NewGroupScreen extends StatefulWidget {
  const NewGroupScreen({super.key});

  @override
  State<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends State<NewGroupScreen> {
  final _name = TextEditingController();
  final Map<String, PingUser> _selected = {};
  bool _creating = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pickMembers() async {
    final chosen = await Navigator.of(context).push<List<PingUser>>(
      MaterialPageRoute(
        builder: (_) => ContactPickerScreen(
          multiSelect: true,
          title: 'Mitglieder wählen',
          excludeIds: _selected.keys.toSet(),
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    setState(() {
      for (final u in chosen) {
        _selected[u.id] = u;
      }
    });
  }

  void _remove(PingUser u) => setState(() => _selected.remove(u.id));

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
    final state = context.read<AppState>();
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
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
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
              height: 96,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: _selected.values
                    .map((u) => _SelectedChip(
                          user: u,
                          imageUrl: state.avatarUrl(u),
                          imageHeaders: state.authHeaders,
                          onRemove: () => _remove(u),
                        ))
                    .toList(),
              ),
            ),
          const SizedBox(height: 8),
          ListTile(
            leading: CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              child: Icon(Icons.person_add_rounded,
                  color: scheme.onPrimaryContainer),
            ),
            title: const Text('Mitglieder aus Kontakten hinzufügen',
                style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(_selected.isEmpty
                ? 'Wähle Leute, die schon bei Ping sind'
                : '${_selected.length} ausgewählt'),
            onTap: _pickMembers,
          ),
          const Divider(height: 1),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Text(
                  _selected.isEmpty
                      ? 'Du kannst die Gruppe auch ohne Mitglieder starten und '
                          'später Leute hinzufügen.'
                      : 'Tipp oben rechts auf „Erstellen", wenn alle dabei sind.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SelectedChip extends StatelessWidget {
  final PingUser user;
  final VoidCallback onRemove;
  final String? imageUrl;
  final Map<String, String>? imageHeaders;
  const _SelectedChip({
    required this.user,
    required this.onRemove,
    this.imageUrl,
    this.imageHeaders,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Column(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              PingAvatar(
                initials: user.initials,
                color: user.color,
                size: 50,
                imageUrl: imageUrl,
                imageHeaders: imageHeaders,
              ),
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
              user.label.split(' ').first,
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
