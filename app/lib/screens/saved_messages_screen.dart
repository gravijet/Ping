import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/starred_store.dart';
import '../utils/format.dart';
import '../widgets/brand.dart';

/// "Gespeichert" — the user's bookmarked messages, collected from every chat.
class SavedMessagesScreen extends StatefulWidget {
  const SavedMessagesScreen({super.key});

  @override
  State<SavedMessagesScreen> createState() => _SavedMessagesScreenState();
}

class _SavedMessagesScreenState extends State<SavedMessagesScreen> {
  List<StarredMessage>? _items;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final items = await context.read<AppState>().starredMessages();
    if (mounted) setState(() => _items = items);
  }

  Future<void> _remove(StarredMessage m) async {
    await context.read<AppState>().unstar(m.message.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final items = _items;
    return Scaffold(
      appBar: pingAppBar(context, title: const Text('Gespeichert')),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
              ? _empty(context)
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => Divider(
                    height: 1,
                    indent: 20,
                    endIndent: 20,
                    color: scheme.outlineVariant.withValues(alpha: 0.3),
                  ),
                  itemBuilder: (context, i) =>
                      _SavedTile(item: items[i], onRemove: () => _remove(items[i])),
                ),
    );
  }

  Widget _empty(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.star_rounded,
                size: 80, color: scheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 18),
            Text('Noch nichts gespeichert',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              'Halte eine Nachricht gedrückt und tippe auf „Markieren", um sie '
              'hier zu sammeln.',
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

class _SavedTile extends StatelessWidget {
  final StarredMessage item;
  final VoidCallback onRemove;
  const _SavedTile({required this.item, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final m = item.message;
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(20, 6, 12, 6),
      onLongPress: () {
        Clipboard.setData(ClipboardData(text: m.body));
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('In die Zwischenablage kopiert.')));
      },
      title: Row(
        children: [
          Icon(Icons.chat_bubble_rounded,
              size: 13, color: scheme.primary.withValues(alpha: 0.7)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              item.chatTitle.isEmpty ? 'Chat' : item.chatTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w700,
                  fontSize: 13),
            ),
          ),
          Text(
            TimeFormat.receiptStamp(item.starredAt),
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 11),
          ),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          m.preview,
          maxLines: 4,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 15, height: 1.3),
        ),
      ),
      trailing: IconButton(
        tooltip: 'Entfernen',
        icon: Icon(Icons.star_rounded, color: scheme.primary),
        onPressed: onRemove,
      ),
    );
  }
}
