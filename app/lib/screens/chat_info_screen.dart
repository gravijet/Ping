import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/wallpaper_service.dart';
import '../widgets/avatar.dart';
import '../widgets/wallpaper_picker.dart';
import '../utils/format.dart';
import 'add_members_screen.dart';

/// Bottom sheet to set or clear a chat's own wallpaper. Picking "Standard"
/// (the default swatch) clears the override so the chat inherits the global
/// wallpaper again.
void _editChatWallpaper(BuildContext context, AppState state, String chatId) {
  showModalBottomSheet(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 4, 0, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Text('Hintergrund für diesen Chat',
                  style: Theme.of(ctx).textTheme.titleMedium),
            ),
            WallpaperPicker(
              current: state.hasChatWallpaper(chatId)
                  ? state.wallpaperFor(chatId)
                  : WallpaperSpec.defaultBg,
              defaultLabel: 'Global',
              onPick: (spec) {
                // Default swatch → inherit the global wallpaper again.
                if (spec.kind == WallpaperKind.defaultBg) {
                  state.setChatWallpaper(chatId, null);
                } else {
                  state.setChatWallpaper(chatId, spec);
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
}

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
    // I'm the group owner ("admin") — unlocks editing the group.
    final isOwner = chat.isGroup && chat.ownerId == state.me?.id;

    return Scaffold(
      appBar: AppBar(title: Text(chat.isGroup ? 'Gruppeninfo' : 'Kontaktinfo')),
      body: ListView(
        children: [
          const SizedBox(height: 16),
          Center(
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                PingAvatar(
                  initials: chat.isGroup
                      ? chat.initials
                      : (chat.otherUser?.initials ?? chat.initials),
                  color: chat.color,
                  size: 104,
                  icon: chat.isGroup ? Icons.groups_rounded : null,
                  imageUrl: chat.isGroup
                      ? state.groupAvatarUrl(chat)
                      : state.avatarUrl(chat.otherUser),
                  imageHeaders: state.authHeaders,
                ),
                if (isOwner)
                  Positioned(
                    right: -4,
                    bottom: -4,
                    child: Material(
                      color: scheme.primary,
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: () => _editGroupPhoto(context, state, chat),
                        child: const Padding(
                          padding: EdgeInsets.all(8),
                          child: Icon(Icons.photo_camera_rounded,
                              color: Colors.white, size: 18),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(chat.title,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall),
                ),
                if (isOwner) ...[
                  const SizedBox(width: 4),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.edit_rounded, size: 20),
                    tooltip: 'Gruppe bearbeiten',
                    onPressed: () => _editGroupInfo(context, state, chat),
                  ),
                ],
              ],
            ),
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
          if (chat.isGroup && chat.description.isNotEmpty) ...[
            const SizedBox(height: 20),
            _Section(title: 'Beschreibung', child: Text(chat.description)),
          ],
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
          ListTile(
            leading: const Icon(Icons.wallpaper_rounded),
            title: const Text('Hintergrund für diesen Chat'),
            subtitle: Text(state.hasChatWallpaper(chat.id)
                ? 'Eigener Hintergrund festgelegt'
                : 'Globaler Hintergrund wird verwendet'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => _editChatWallpaper(context, state, chat.id),
          ),
          if (!chat.isGroup && chat.otherUser != null) ...[
            const Divider(height: 24),
            Builder(builder: (context) {
              final blocked = state.isBlocked(chat.otherUser!.id);
              return ListTile(
                leading: Icon(
                    blocked ? Icons.lock_open_rounded : Icons.block_rounded,
                    color: scheme.error),
                title: Text(
                  blocked
                      ? 'Blockierung aufheben'
                      : '${chat.otherUser!.label} blockieren',
                  style: TextStyle(color: scheme.error),
                ),
                subtitle: Text(blocked
                    ? 'Diese Person kann dir wieder schreiben.'
                    : 'Blockierte Personen können dir nicht mehr schreiben.'),
                onTap: () async {
                  try {
                    if (blocked) {
                      await state.unblockUser(chat.otherUser!.id);
                    } else {
                      await state.blockUser(chat.otherUser!.id);
                    }
                  } on ApiException catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(content: Text(e.message)));
                    }
                  }
                },
              );
            }),
          ],
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
              final memberIsOwner = m.id == chat.ownerId;
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
                trailing: memberIsOwner
                    ? Chip(
                        label: const Text('Admin'),
                        visualDensity: VisualDensity.compact,
                        backgroundColor: scheme.primaryContainer,
                        side: BorderSide.none,
                      )
                    : (isOwner && !isMe
                        ? IconButton(
                            icon: const Icon(Icons.more_vert_rounded),
                            tooltip: 'Optionen',
                            onPressed: () =>
                                _memberActions(context, state, chat, m),
                          )
                        : null),
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

  void _snack(BuildContext context, String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _imageMime(String path) {
    final p = path.toLowerCase();
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  Future<void> _editGroupPhoto(
      BuildContext context, AppState state, Chat chat) async {
    final scheme = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Aus Galerie'),
              onTap: () {
                Navigator.pop(ctx);
                _pickGroupPhoto(context, state, chat, ImageSource.gallery);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Foto aufnehmen'),
              onTap: () {
                Navigator.pop(ctx);
                _pickGroupPhoto(context, state, chat, ImageSource.camera);
              },
            ),
            if (chat.hasAvatar)
              ListTile(
                leading: Icon(Icons.delete_outline_rounded, color: scheme.error),
                title: Text('Bild entfernen',
                    style: TextStyle(color: scheme.error)),
                onTap: () async {
                  Navigator.pop(ctx);
                  try {
                    await state.removeGroupAvatar(chat.id);
                  } on ApiException catch (e) {
                    if (context.mounted) _snack(context, e.message);
                  }
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickGroupPhoto(
      BuildContext context, AppState state, Chat chat, ImageSource source) async {
    try {
      final f = await ImagePicker()
          .pickImage(source: source, imageQuality: 85, maxWidth: 1024);
      if (f == null) return;
      final bytes = await f.readAsBytes();
      await state.uploadGroupAvatar(
          chat.id, bytes, f.mimeType ?? _imageMime(f.path));
      if (context.mounted) _snack(context, 'Gruppenbild aktualisiert.');
    } on ApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    } catch (_) {
      if (context.mounted) _snack(context, 'Bild konnte nicht geladen werden.');
    }
  }

  Future<void> _editGroupInfo(
      BuildContext context, AppState state, Chat chat) async {
    final nameC = TextEditingController(text: chat.title);
    final descC = TextEditingController(text: chat.description);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Gruppe bearbeiten'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameC,
              maxLength: 80,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Gruppenname'),
            ),
            TextField(
              controller: descC,
              maxLength: 500,
              maxLines: 3,
              minLines: 1,
              textCapitalization: TextCapitalization.sentences,
              decoration:
                  const InputDecoration(labelText: 'Beschreibung (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Speichern')),
        ],
      ),
    );
    if (ok != true) return;
    final name = nameC.text.trim();
    if (name.isEmpty) {
      if (context.mounted) _snack(context, 'Der Gruppenname darf nicht leer sein.');
      return;
    }
    try {
      await state.updateGroup(chat.id, name: name, description: descC.text.trim());
      if (context.mounted) _snack(context, 'Gruppe aktualisiert.');
    } on ApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
  }

  void _memberActions(
      BuildContext context, AppState state, Chat chat, PingUser m) {
    final scheme = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(Icons.person_remove_rounded, color: scheme.error),
              title: Text('${m.label} entfernen',
                  style: TextStyle(color: scheme.error)),
              onTap: () async {
                Navigator.pop(ctx);
                await _confirmRemoveMember(context, state, chat, m);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmRemoveMember(
      BuildContext context, AppState state, Chat chat, PingUser m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${m.label} entfernen?'),
        content: const Text(
            'Die Person verlässt die Gruppe und sieht keine neuen Nachrichten '
            'mehr.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Entfernen'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await state.removeGroupMember(chat.id, m.id);
    } on ApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
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
