import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/status.dart';
import '../models/user.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/verified_badge.dart';
import 'status_composer_screen.dart';
import 'status_viewer_screen.dart';

/// Offer text / photo / video statuses (gallery or camera), then route there.
/// When [official] is set, the composer posts as the "Ping Team" account so the
/// update reaches every user (admin only) — text, image *and* video are allowed.
Future<void> showAddStatusSheet(BuildContext context, {bool official = false}) async {
  await showModalBottomSheet(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (official)
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Row(
                children: [
                  PingBadge(kind: BadgeKind.official, size: 22),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Offizieller Status — für alle Ping-Nutzer sichtbar.',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.title_rounded)),
            title: const Text('Text'),
            subtitle: const Text('Schreib etwas auf einen farbigen Hintergrund'),
            onTap: () {
              Navigator.pop(ctx);
              Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => StatusTextComposer(official: official)));
            },
          ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.photo_camera_rounded)),
            title: const Text('Foto aufnehmen'),
            subtitle: const Text('Mit der Kamera ein Bild machen'),
            onTap: () {
              Navigator.pop(ctx);
              _pickStatusImage(context, ImageSource.camera, official);
            },
          ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.photo_rounded)),
            title: const Text('Foto aus Galerie'),
            subtitle: const Text('Teile ein Bild aus der Galerie'),
            onTap: () {
              Navigator.pop(ctx);
              _pickStatusImage(context, ImageSource.gallery, official);
            },
          ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.videocam_rounded)),
            title: const Text('Video aufnehmen'),
            subtitle: const Text('Bis zu 30 Sekunden'),
            onTap: () {
              Navigator.pop(ctx);
              _pickStatusVideo(context, ImageSource.camera, official);
            },
          ),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.video_library_rounded)),
            title: const Text('Video aus Galerie'),
            subtitle: const Text('Ein Video aus der Galerie teilen'),
            onTap: () {
              Navigator.pop(ctx);
              _pickStatusVideo(context, ImageSource.gallery, official);
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

Future<void> _pickStatusImage(
    BuildContext context, ImageSource source, bool official) async {
  final file = await ImagePicker()
      .pickImage(source: source, imageQuality: 85, maxWidth: 1920);
  if (file == null || !context.mounted) return;
  final bytes = await file.readAsBytes();
  if (!context.mounted) return;
  Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => StatusImageComposer(
      bytes: bytes,
      contentType: file.mimeType ?? 'image/jpeg',
      filename: file.name,
      official: official,
    ),
  ));
}

Future<void> _pickStatusVideo(
    BuildContext context, ImageSource source, bool official) async {
  // The maximum status video length is server-tunable (remote config) so it can
  // be changed without an app update.
  final maxSecs =
      context.read<AppState>().remoteConfig.intValue('maxStatusSeconds', 30);
  final file = await ImagePicker()
      .pickVideo(source: source, maxDuration: Duration(seconds: maxSecs));
  if (file == null || !context.mounted) return;
  Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => StatusVideoComposer(
      path: file.path,
      contentType: file.mimeType ?? 'video/mp4',
      filename: file.name,
      official: official,
    ),
  ));
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
            // Your own statuses count as seen, so the ring is a calm grey.
            seen: mine.isEmpty
                ? const [true]
                : List<bool>.filled(mine.length, true),
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
    final scheme = Theme.of(context).colorScheme;
    final official = group.user.official;
    final unseen = group.items.where((s) => !s.seen).length;
    final time = TimeFormat.messageTime(
        DateTime.fromMillisecondsSinceEpoch(group.updatedAt));
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: _Ring(
        seen: [for (final s in group.items) s.seen],
        official: official,
        // A fully-watched ring fades its avatar a touch, so "new" stands out.
        child: Opacity(
          opacity: unseen == 0 && !official ? 0.6 : 1.0,
          child: PingAvatar(
            initials: group.user.initials,
            color: group.user.color,
            size: 52,
            imageUrl: state.avatarUrl(group.user),
            imageHeaders: state.authHeaders,
          ),
        ),
      ),
      title: NameWithBadge(
        name: group.user.label,
        user: group.user,
        style: TextStyle(
            fontWeight: unseen > 0 ? FontWeight.w700 : FontWeight.w600),
      ),
      subtitle: Text(
        official
            ? 'Offizielles Update · $time'
            : unseen > 0
                ? '$unseen neu · $time'
                : 'Angesehen · $time',
        style: TextStyle(
          color: (official || unseen > 0)
              ? scheme.primary
              : scheme.onSurfaceVariant,
          fontWeight: (official || unseen > 0) ? FontWeight.w600 : null,
        ),
      ),
      onTap: onTap,
    );
  }
}

/// A segmented status ring around an avatar — one arc per status item, like
/// WhatsApp/Instagram. Unseen segments glow in the brand gradient; segments
/// you've already watched fade to a calm grey, so it's obvious at a glance how
/// much is still new. The official "Ping Team" ring always glows.
class _Ring extends StatelessWidget {
  /// One flag per status item: `true` = already seen (grey), `false` = unseen.
  final List<bool> seen;
  final bool official;
  final Widget child;
  const _Ring({
    required this.seen,
    required this.child,
    this.official = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return CustomPaint(
      painter: _RingPainter(
        seen: seen,
        official: official,
        seenColor: scheme.outlineVariant.withValues(alpha: 0.7),
        surface: scheme.surface,
      ),
      child: Padding(
        padding: const EdgeInsets.all(4.5),
        child: child,
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final List<bool> seen;
  final bool official;
  final Color seenColor;
  final Color surface;

  static const _unseen = [Color(0xFF0A84FF), Color(0xFF34B7F1)];

  _RingPainter({
    required this.seen,
    required this.official,
    required this.seenColor,
    required this.surface,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Unseen arcs are drawn noticeably thicker than already-seen ones, so at a
    // glance a vivid, bold ring = new and a thin grey ring = all watched.
    const unseenStroke = 3.6;
    const seenStroke = 1.6;
    final center = size.center(Offset.zero);
    final radius = size.shortestSide / 2 - unseenStroke / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);
    final n = seen.isEmpty ? 1 : seen.length;
    final gap = n == 1 ? 0.0 : math.min(0.16, 0.9 / n);
    final sweep = (2 * math.pi - gap * n) / n;

    // The narrow surface-coloured gap between the ring and the avatar.
    canvas.drawCircle(
      center,
      radius - unseenStroke / 2 - 1.4,
      Paint()..color = surface,
    );

    final unseenShader = const SweepGradient(
      colors: [..._unseen, Color(0xFF0A84FF)],
    ).createShader(rect);

    // A soft glow under any vivid (unseen / official) arc to make "new" pop.
    final hasVivid = official || (seen.isNotEmpty && seen.any((s) => !s));
    if (hasVivid) {
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = unseenStroke + 1.5
          ..color = const Color(0xFF0A84FF).withValues(alpha: 0.40)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
      );
    }

    var start = -math.pi / 2 + gap / 2;
    for (var i = 0; i < n; i++) {
      final isSeen = seen.isEmpty ? false : seen[i];
      final vivid = official || !isSeen;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = vivid ? unseenStroke : seenStroke
        ..strokeCap = n == 1 ? StrokeCap.butt : StrokeCap.round;
      if (vivid) {
        paint.shader = unseenShader;
      } else {
        paint.color = seenColor;
      }
      canvas.drawArc(rect, start, sweep, false, paint);
      start += sweep + gap;
    }
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      official != old.official ||
      surface != old.surface ||
      seenColor != old.seenColor ||
      !listEquals(seen, old.seen);
}
