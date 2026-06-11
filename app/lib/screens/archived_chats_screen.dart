import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/chat_tile.dart';
import 'chat_screen.dart';

/// The collapsed "Archiviert" section: every chat the user has archived.
/// Long-pressing offers to bring a chat back; tapping opens it normally.
class ArchivedChatsScreen extends StatelessWidget {
  const ArchivedChatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final archived = state.chats.where((c) => c.archived).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Archiviert')),
      body: archived.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Text(
                  'Keine archivierten Chats.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.only(top: 4, bottom: 24),
              itemCount: archived.length,
              separatorBuilder: (_, _) => Divider(
                indent: 84,
                endIndent: 16,
                color: scheme.outlineVariant.withValues(alpha: 0.3),
              ),
              itemBuilder: (context, i) {
                final chat = archived[i];
                return ChatTile(
                  chat: chat,
                  pinned: false,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => ChatScreen(chatId: chat.id)),
                  ),
                  onLongPress: () => _showMenu(context, state, chat),
                );
              },
            ),
    );
  }

  void _showMenu(BuildContext context, AppState state, Chat chat) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.unarchive_outlined),
              title: const Text('Aus dem Archiv holen'),
              onTap: () async {
                Navigator.pop(ctx);
                try {
                  await state.toggleArchive(chat.id, false);
                } on ApiException catch (e) {
                  if (context.mounted) {
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
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
