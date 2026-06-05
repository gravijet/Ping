import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import '../utils/format.dart';
import 'add_members_screen.dart';

class ChatInfoScreen extends StatelessWidget {
  final String chatId;
  const ChatInfoScreen({super.key, required this.chatId});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final idx = state.chats.indexWhere((c) => c.id == chatId);
    if (idx == -1) {
      return const Scaffold(
        body: Center(child: Text('Dieser Chat ist nicht mehr verfügbar.')),
      );
    }
    final chat = state.chats[idx];
    final scheme = Theme.of(context).colorScheme;
    final online = !chat.isGroup &&
        chat.otherUser != null &&
        state.isOnline(chat.otherUser!.id);

    return Scaffold(
      appBar: AppBar(title: Text(chat.isGroup ? 'Gruppeninfo' : 'Kontaktinfo')),
      body: ListView(
        children: [
          const SizedBox(height: 16),
          Center(
            child: PingAvatar(
              initials: chat.isGroup
                  ? chat.initials
                  : (chat.otherUser?.initials ?? chat.initials),
              color: chat.color,
              size: 104,
              icon: chat.isGroup ? Icons.groups_rounded : null,
              imageUrl: chat.isGroup ? null : state.avatarUrl(chat.otherUser),
              imageHeaders: state.authHeaders,
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(chat.title,
                style: Theme.of(context).textTheme.headlineSmall),
          ),
          const SizedBox(height: 4),
          Center(
            child: Text(
              chat.isGroup
                  ? '${chat.memberIds.length} Mitglieder'
                  : (online
                      ? 'online'
                      : TimeFormat.lastSeen(chat.otherUser?.lastSeen)),
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ),
          if (!chat.isGroup &&
              chat.otherUser != null &&
              chat.otherUser!.about.isNotEmpty) ...[
            const SizedBox(height: 20),
            _Section(
              title: 'Über',
              child: Text(chat.otherUser!.about),
            ),
          ],
          const SizedBox(height: 20),
          SwitchListTile(
            secondary: Icon(chat.muted
                ? Icons.notifications_off_rounded
                : Icons.notifications_active_rounded),
            title: const Text('Benachrichtigungen stumm'),
            subtitle: Text(chat.muted
                ? 'Du bekommst keine Hinweise für diesen Chat.'
                : 'Du wirst über neue Nachrichten informiert.'),
            value: chat.muted,
            onChanged: (v) => state.toggleMute(chat.id, v),
          ),
          if (chat.isGroup) ...[
            const Divider(height: 24),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text('Mitglieder',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(color: scheme.onSurfaceVariant)),
            ),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: scheme.primaryContainer,
                child: Icon(Icons.person_add_alt_1_rounded,
                    color: scheme.onPrimaryContainer),
              ),
              title: const Text('Mitglieder hinzufügen',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => AddMembersScreen(
                    chatId: chat.id,
                    existingMemberIds: chat.memberIds.toSet(),
                  ),
                ),
              ),
            ),
            ...chat.members.map((m) {
              final isMe = m.id == state.me?.id;
              final isOwner = m.id == chat.ownerId;
              return ListTile(
                leading: PingAvatar(
                  initials: m.initials,
                  color: m.color,
                  size: 44,
                  online: state.isOnline(m.id),
                  imageUrl: state.avatarUrl(m),
                  imageHeaders: state.authHeaders,
                ),
                title: Text(isMe ? '${m.label} (Du)' : m.label),
                subtitle: Text(m.about.isNotEmpty
                    ? m.about
                    : (state.isOnline(m.id) ? 'online' : 'Auf Ping')),
                trailing: isOwner
                    ? Chip(
                        label: const Text('Admin'),
                        visualDensity: VisualDensity.compact,
                        backgroundColor: scheme.primaryContainer,
                        side: BorderSide.none,
                      )
                    : null,
              );
            }),
            const Divider(height: 24),
            ListTile(
              leading: Icon(Icons.logout_rounded, color: scheme.error),
              title: Text('Gruppe verlassen',
                  style: TextStyle(color: scheme.error)),
              onTap: () => _confirmLeave(context, state, chat),
            ),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Future<void> _confirmLeave(
      BuildContext context, AppState state, Chat chat) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('„${chat.title}" verlassen?'),
        content: const Text(
            'Du siehst dann keine neuen Nachrichten mehr und musst neu '
            'eingeladen werden, um zurückzukommen.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Verlassen'),
          ),
        ],
      ),
    );
    if (ok == true) {
      try {
        await state.leaveGroup(chat.id);
        if (context.mounted) {
          // Pop info + chat screen back to the list.
          Navigator.of(context)
            ..pop()
            ..pop();
        }
      } on ApiException catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(e.message)));
        }
      }
    }
  }
}

class _Section extends StatelessWidget {
  final String title;
  final Widget child;
  const _Section({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 6),
          child,
        ],
      ),
    );
  }
}
