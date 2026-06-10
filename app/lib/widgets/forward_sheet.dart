import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../services/app_state.dart';
import 'avatar.dart';

/// Pick one or more chats to forward a message into. Returns the selected chat
/// ids, or null if cancelled.
Future<List<String>?> showForwardSheet(BuildContext context) {
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _ForwardSheet(),
  );
}

class _ForwardSheet extends StatefulWidget {
  const _ForwardSheet();

  @override
  State<_ForwardSheet> createState() => _ForwardSheetState();
}

class _ForwardSheetState extends State<_ForwardSheet> {
  final Set<String> _selected = {};
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final q = _query.trim().toLowerCase();
    final chats = state.chats
        .where((c) => q.isEmpty || c.displayTitle.toLowerCase().contains(q))
        .toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (ctx, controller) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Row(
              children: [
                Text('Weiterleiten an …',
                    style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (_selected.isNotEmpty)
                  Text('${_selected.length} ausgewählt',
                      style: TextStyle(
                          color: scheme.primary, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              onChanged: (v) => setState(() => _query = v),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                hintText: 'Chat suchen',
                isDense: true,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              controller: controller,
              itemCount: chats.length,
              itemBuilder: (context, i) {
                final c = chats[i];
                final selected = _selected.contains(c.id);
                return _ChatRow(
                  chat: c,
                  selected: selected,
                  onTap: () => setState(() {
                    if (!_selected.add(c.id)) _selected.remove(c.id);
                  }),
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: FilledButton.icon(
                onPressed: _selected.isEmpty
                    ? null
                    : () => Navigator.pop(context, _selected.toList()),
                icon: const Icon(Icons.send_rounded),
                label: Text(_selected.isEmpty
                    ? 'Chats auswählen'
                    : 'An ${_selected.length} senden'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  final Chat chat;
  final bool selected;
  final VoidCallback onTap;
  const _ChatRow(
      {required this.chat, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      onTap: onTap,
      leading: PingAvatar(
        initials: chat.isGroup
            ? chat.initials
            : (chat.otherUser?.initials ?? chat.initials),
        color: chat.color,
        size: 44,
        icon: chat.isGroup
            ? Icons.groups_rounded
            : (chat.self ? Icons.bookmark_rounded : null),
        imageUrl: chat.isGroup
            ? state.groupAvatarUrl(chat)
            : state.avatarUrl(chat.otherUser),
        imageHeaders: state.authHeaders,
      ),
      title: Text(chat.displayTitle,
          maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: selected
          ? Icon(Icons.check_circle_rounded, color: scheme.primary)
          : Icon(Icons.circle_outlined,
              color: scheme.outlineVariant),
    );
  }
}
