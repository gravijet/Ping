import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/status.dart';
import '../models/user.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import 'status_composer_screen.dart';
import 'status_viewer_screen.dart';

/// Offer the choice between a text and a photo status, then route accordingly.
Future<void> showAddStatusSheet(BuildContext context) async {
  await showModalBottomSheet(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.title_rounded)),
            title: const Text('Text'),
            subtitle: const Text('Schreib etwas auf einen farbigen Hintergrund'),
            onTap: () {
              Navigator.pop(ctx);
              Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const StatusTextComposer()));
            },
          ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.photo_rounded)),
            title: const Text('Foto'),
            subtitle: const Text('Teile ein Bild aus der Galerie'),
            onTap: () async {
              Navigator.pop(ctx);
              final picker = ImagePicker();
              final file = await picker.pickImage(
                  source: ImageSource.gallery, imageQuality: 85, maxWidth: 1920);
              if (file == null || !context.mounted) return;
              final bytes = await file.readAsBytes();
              if (!context.mounted) return;
              Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => StatusImageComposer(
                  bytes: bytes,
                  contentType: file.mimeType ?? 'image/jpeg',
                  filename: file.name,
                ),
              ));
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

/// The Status ("Updates") tab: your own status plus your contacts' rings.
class StatusTab extends StatelessWidget {
  const StatusTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final me = state.me;
    final scheme = Theme.of(context).colorScheme;

    return RefreshIndicator(
      onRefresh: state.loadStatus,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          _MyStatusTile(state: state, me: me),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text(
              'Aktuelle Updates',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: scheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          if (state.statusOthers.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
              child: Text(
                'Noch keine Updates. Sobald Kontakte einen Status teilen, '
                'erscheinen sie hier — sie verschwinden nach 24 Stunden wieder.',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            )
          else
            for (var i = 0; i < state.statusOthers.length; i++)
              _StatusGroupTile(
                state: state,
                group: state.statusOthers[i],
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => StatusViewerScreen(
                    groups: state.statusOthers,
                    initialGroup: i,
                  ),
                )),
              ),
        ],
      ),
    );
  }
}

class _MyStatusTile extends StatelessWidget {
  final AppState state;
  final PingUser? me;
  const _MyStatusTile({required this.state, required this.me});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final mine = state.statusMine;
    final has = mine.isNotEmpty;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: Stack(
        clipBehavior: Clip.none,
        children: [
          _Ring(
            hasUnseen: false,
            child: PingAvatar(
              initials: me?.initials ?? '',
              color: me?.color ?? scheme.primary,
              size: 52,
              imageUrl: state.avatarUrl(me),
              imageHeaders: state.authHeaders,
            ),
          ),
          Positioned(
            right: -2,
            bottom: -2,
            child: Container(
              decoration: BoxDecoration(
                color: scheme.primary,
                shape: BoxShape.circle,
                border: Border.all(color: scheme.surface, width: 2),
              ),
              padding: const EdgeInsets.all(2),
              child: const Icon(Icons.add_rounded, color: Colors.white, size: 16),
            ),
          ),
        ],
      ),
      title: const Text('Mein Status',
          style: TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(has
          ? '${mine.length} Update${mine.length == 1 ? '' : 's'} · ${TimeFormat.messageTime(DateTime.fromMillisecondsSinceEpoch(mine.last.createdAt))}'
          : 'Tippe, um ein Update zu teilen'),
      trailing: has
          ? IconButton(
              icon: const Icon(Icons.add_circle_outline_rounded),
              onPressed: () => showAddStatusSheet(context),
            )
          : null,
      onTap: () {
        if (has) {
          Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => StatusViewerScreen(
              groups: [
                StatusGroup(
                  user: me ??
                      const PingUser(
                          id: '', phone: '', displayName: 'Ich', avatarColor: '#0A84FF'),
                  items: mine,
                  hasUnseen: false,
                  updatedAt: mine.last.createdAt,
                )
              ],
              mine: true,
            ),
          ));
        } else {
          showAddStatusSheet(context);
        }
      },
    );
  }
}

class _StatusGroupTile extends StatelessWidget {
  final AppState state;
  final StatusGroup group;
  final VoidCallback onTap;
  const _StatusGroupTile({
    required this.state,
    required this.group,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: _Ring(
        hasUnseen: group.hasUnseen,
        child: PingAvatar(
          initials: group.user.initials,
          color: group.user.color,
          size: 52,
          imageUrl: state.avatarUrl(group.user),
          imageHeaders: state.authHeaders,
        ),
      ),
      title: Text(group.user.label,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(TimeFormat.messageTime(
          DateTime.fromMillisecondsSinceEpoch(group.updatedAt))),
      onTap: onTap,
    );
  }
}

/// A status "ring" around an avatar: a blue gradient when there's something
/// unseen, otherwise a subtle grey.
class _Ring extends StatelessWidget {
  final bool hasUnseen;
  final Widget child;
  const _Ring({required this.hasUnseen, required this.child});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(2.5),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: hasUnseen
            ? const LinearGradient(
                colors: [Color(0xFF0A84FF), Color(0xFF34B7F1)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              )
            : null,
        color: hasUnseen ? null : scheme.outlineVariant.withValues(alpha: 0.6),
      ),
      child: Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: scheme.surface,
        ),
        child: child,
      ),
    );
  }
}
