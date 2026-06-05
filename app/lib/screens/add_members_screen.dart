import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import 'contact_picker_screen.dart';

/// Pick people from your contacts and add them to an existing group.
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
  final Map<String, PingUser> _selected = {};
  bool _saving = false;

  Future<void> _pick() async {
    final chosen = await Navigator.of(context).push<List<PingUser>>(
      MaterialPageRoute(
        builder: (_) => ContactPickerScreen(
          multiSelect: true,
          title: 'Mitglieder wählen',
          excludeIds: {...widget.existingMemberIds, ..._selected.keys},
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
    final state = context.read<AppState>();
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
          const SizedBox(height: 8),
          ListTile(
            leading: CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              child: Icon(Icons.person_add_rounded,
                  color: scheme.onPrimaryContainer),
            ),
            title: const Text('Aus Kontakten wählen',
                style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(_selected.isEmpty
                ? 'Leute, die schon bei Ping sind'
                : '${_selected.length} ausgewählt'),
            onTap: _pick,
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
          const Divider(height: 1),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Text(
                  _selected.isEmpty
                      ? 'Wähle Kontakte aus, die du in die Gruppe einladen '
                          'möchtest.'
                      : 'Tipp oben rechts auf „Hinzufügen", wenn alle dabei sind.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
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
