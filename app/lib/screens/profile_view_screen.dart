import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/user.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/verified_badge.dart';
import 'chat_screen.dart';
import 'profile_edit_screen.dart';

/// A rich, shareable profile page: banner background, (optionally animated)
/// avatar, mood, pronouns, bio, info chips and link chips. Used both for the
/// signed-in user (with an edit button) and for other people (with message /
/// call actions).
class ProfileViewScreen extends StatefulWidget {
  final String userId;
  final bool isMe;

  const ProfileViewScreen({super.key, required this.userId, this.isMe = false});

  @override
  State<ProfileViewScreen> createState() => _ProfileViewScreenState();
}

class _ProfileViewScreenState extends State<ProfileViewScreen> {
  @override
  void initState() {
    super.initState();
    // Pull the freshest public profile if we're showing someone else and don't
    // have them cached yet (or to refresh their info/mood).
    if (!widget.isMe) {
      context.read<AppState>().fetchUser(widget.userId).then((_) {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    // Always render the freshest copy we have: the signed-in identity for "me",
    // otherwise the live user cache (kept in sync over the socket).
    final user =
        widget.isMe ? state.me : (state.cachedUser(widget.userId) ?? state.me);
    final isMe = widget.isMe;
    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final scheme = Theme.of(context).colorScheme;
    final accent = user.accent;
    final online = !isMe && state.isOnline(user.id);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 230,
            pinned: true,
            backgroundColor: accent,
            foregroundColor: Colors.white,
            actions: [
              if (isMe)
                IconButton(
                  tooltip: 'Profil bearbeiten',
                  icon: const Icon(Icons.edit_rounded),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => const ProfileEditScreen()),
                  ),
                ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              background: _Banner(user: user, accent: accent),
            ),
          ),
          SliverToBoxAdapter(
            child: Transform.translate(
              offset: const Offset(0, -52),
              child: Column(
                children: [
                  _AvatarBadge(user: user, accent: accent, online: online),
                  const SizedBox(height: 12),
                  NameWithBadge(
                    name: user.label,
                    user: user,
                    glow: user.official,
                    badgeSize: 22,
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  if (user.pronouns.trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(user.pronouns,
                          style: TextStyle(color: scheme.onSurfaceVariant)),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    isMe
                        ? user.phone
                        : (online
                            ? 'online'
                            : TimeFormat.lastSeen(user.lastSeen)),
                    style: TextStyle(
                        color: online ? const Color(0xFF22C55E) : scheme.onSurfaceVariant,
                        fontWeight: online ? FontWeight.w600 : FontWeight.normal),
                  ),
                  if (user.hasMood) ...[
                    const SizedBox(height: 12),
                    _MoodPill(user: user, accent: accent),
                  ],
                  const SizedBox(height: 20),
                  if (!isMe) _Actions(user: user, accent: accent),
                  _Body(user: user, accent: accent, isMe: isMe),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  final PingUser user;
  final Color accent;
  const _Banner({required this.user, required this.accent});

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final bannerUrl = state.bannerUrl(user);
    final gradient = DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color.lerp(accent, Colors.white, 0.12)!,
            Color.lerp(accent, Colors.black, 0.28)!,
          ],
        ),
      ),
    );
    return Stack(
      fit: StackFit.expand,
      children: [
        if (bannerUrl != null)
          Image.network(
            bannerUrl,
            headers: state.authHeaders,
            fit: BoxFit.cover,
            loadingBuilder: (c, child, p) => p == null ? child : gradient,
            errorBuilder: (c, e, s) => gradient,
          )
        else
          gradient,
        // A bottom scrim so the avatar + name read clearly over any image.
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.center,
              end: Alignment.bottomCenter,
              colors: [Colors.transparent, Colors.black26],
            ),
          ),
        ),
      ],
    );
  }
}

class _AvatarBadge extends StatelessWidget {
  final PingUser user;
  final Color accent;
  final bool online;
  const _AvatarBadge(
      {required this.user, required this.accent, required this.online});

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: scheme.surface,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.45),
            blurRadius: 22,
            spreadRadius: 1,
          ),
        ],
      ),
      child: PingAvatar(
        initials: user.initials,
        color: user.color,
        size: 104,
        online: online ? true : null,
        imageUrl: state.avatarUrl(user),
        imageHeaders: state.authHeaders,
      ),
    );
  }
}

class _MoodPill extends StatelessWidget {
  final PingUser user;
  final Color accent;
  const _MoodPill({required this.user, required this.accent});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: accent.withValues(alpha: 0.30)),
      ),
      child: Text(
        user.moodLine,
        style: TextStyle(
            color: accent, fontWeight: FontWeight.w600, fontSize: 14.5),
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  final PingUser user;
  final Color accent;
  const _Actions({required this.user, required this.accent});

  Future<void> _message(BuildContext context) async {
    final state = context.read<AppState>();
    final nav = Navigator.of(context);
    try {
      final chat = await state.openDirectChat(user);
      nav.push(MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)));
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Chat konnte nicht geöffnet werden.')),
        );
      }
    }
  }

  Future<void> _call(BuildContext context, {required bool video}) async {
    try {
      await context.read<AppState>().callController.startCall(user, video: video);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Anruf nicht möglich.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Row(
        children: [
          Expanded(
            child: _ActionButton(
              icon: Icons.chat_bubble_rounded,
              label: 'Nachricht',
              accent: accent,
              filled: true,
              onTap: () => _message(context),
            ),
          ),
          const SizedBox(width: 10),
          _ActionButton(
            icon: Icons.call_rounded,
            label: 'Anruf',
            accent: accent,
            onTap: () => _call(context, video: false),
          ),
          const SizedBox(width: 10),
          _ActionButton(
            icon: Icons.videocam_rounded,
            label: 'Video',
            accent: accent,
            onTap: () => _call(context, video: true),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color accent;
  final bool filled;
  final VoidCallback onTap;
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.accent,
    required this.onTap,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    final fg = filled ? Colors.white : accent;
    return Material(
      color: filled ? accent : accent.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
              horizontal: filled ? 20 : 16, vertical: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 19, color: fg),
              const SizedBox(width: 8),
              Text(label,
                  style: TextStyle(color: fg, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  final PingUser user;
  final Color accent;
  final bool isMe;
  const _Body({required this.user, required this.accent, required this.isMe});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final children = <Widget>[];

    if (user.about.trim().isNotEmpty) {
      children.add(_Card(
        accent: accent,
        title: 'Über',
        icon: Icons.info_outline_rounded,
        child: Text(user.about,
            style: const TextStyle(fontSize: 15, height: 1.35)),
      ));
    }

    final info = <Widget>[];
    if (user.city.trim().isNotEmpty) {
      info.add(_InfoChip(
          icon: Icons.place_outlined, label: user.city, accent: accent));
    }
    final bday = _formatBirthday(user.birthday);
    if (bday != null) {
      info.add(_InfoChip(
          icon: Icons.cake_outlined, label: bday, accent: accent));
    }
    if (info.isNotEmpty) {
      children.add(_Card(
        accent: accent,
        title: 'Infos',
        icon: Icons.badge_outlined,
        child: Wrap(spacing: 10, runSpacing: 10, children: info),
      ));
    }

    if (user.links.isNotEmpty) {
      children.add(_Card(
        accent: accent,
        title: 'Links',
        icon: Icons.link_rounded,
        child: Column(
          children: [
            for (final link in user.links) _LinkTile(link: link, accent: accent),
          ],
        ),
      ));
    }

    if (children.isEmpty && isMe) {
      children.add(Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Text(
          'Tippe oben auf das Stift-Symbol, um dein Profil mit Bio, Links, '
          'Hintergrund und mehr zu gestalten.',
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant, height: 1.4),
        ),
      ));
    }

    return Column(children: children);
  }

  static String? _formatBirthday(String raw) {
    final v = raw.trim();
    if (v.isEmpty) return null;
    const months = [
      'Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni',
      'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
    ];
    final parts = v.split('-');
    try {
      if (parts.length == 3) {
        final m = int.parse(parts[1]);
        final d = int.parse(parts[2]);
        return '$d. ${months[m - 1]} ${parts[0]}';
      }
      if (parts.length == 2) {
        final m = int.parse(parts[0]);
        final d = int.parse(parts[1]);
        return '$d. ${months[m - 1]}';
      }
    } catch (_) {
      return v;
    }
    return v;
  }
}

class _Card extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color accent;
  final Widget child;
  const _Card({
    required this.title,
    required this.icon,
    required this.accent,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: accent),
              const SizedBox(width: 8),
              Text(title,
                  style: TextStyle(
                      color: accent,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      letterSpacing: 0.3)),
            ],
          ),
          const SizedBox(height: 12),
          Align(alignment: Alignment.centerLeft, child: child),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color accent;
  const _InfoChip(
      {required this.icon, required this.label, required this.accent});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: accent),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _LinkTile extends StatelessWidget {
  final ProfileLink link;
  final Color accent;
  const _LinkTile({required this.link, required this.accent});

  Future<void> _open(BuildContext context) async {
    final uri = Uri.tryParse(link.url);
    if (uri == null) return;
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Link konnte nicht geöffnet werden.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _open(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Icon(Icons.public_rounded, size: 18, color: accent),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(link.display,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    link.url,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: scheme.onSurfaceVariant, fontSize: 12.5),
                  ),
                ],
              ),
            ),
            Icon(Icons.open_in_new_rounded,
                size: 16, color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
