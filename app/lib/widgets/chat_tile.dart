import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import 'avatar.dart';
import 'receipt_ticks.dart';
import 'verified_badge.dart';

class ChatTile extends StatelessWidget {
  final Chat chat;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final bool pinned;

  const ChatTile({
    super.key,
    required this.chat,
    required this.onTap,
    this.onLongPress,
    this.pinned = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final state = context.watch<AppState>();
    final compact = state.settings.compactChats;
    final last = chat.lastMessage;
    final typing = chat.isGroup
        ? state.typingIn(chat.id).isNotEmpty
        : (chat.otherUser != null &&
            state.typingIn(chat.id).contains(chat.otherUser!.id));

    final online = !chat.isGroup &&
        !chat.self &&
        chat.otherUser != null &&
        state.isOnline(chat.otherUser!.id);

    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: compact ? 6 : 10),
        child: Row(
          children: [
            PingAvatar(
              initials: chat.isGroup
                  ? chat.initials
                  : (chat.otherUser?.initials ?? chat.initials),
              color: chat.color,
              size: compact ? 44 : 54,
              online: chat.isGroup ? null : online,
              icon: chat.isGroup
                  ? Icons.groups_rounded
                  : (chat.self ? Icons.bookmark_rounded : null),
              imageUrl: chat.isGroup
                  ? state.groupAvatarUrl(chat)
                  : state.avatarUrl(chat.otherUser),
              imageHeaders: state.authHeaders,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: NameWithBadge(
                          name: chat.displayTitle,
                          user: chat.isGroup ? null : chat.otherUser,
                          badgeSize: 17,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      if (last != null)
                        Text(
                          TimeFormat.chatStamp(last.time),
                          style: TextStyle(
                            fontSize: 12,
                            color: chat.unread > 0
                                ? scheme.primary
                                : scheme.onSurfaceVariant,
                            fontWeight: chat.unread > 0
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                    ],
                  ),
                  SizedBox(height: compact ? 2 : 4),
                  Row(
                    children: [
                      Expanded(child: _preview(context, state, last, typing)),
                      const SizedBox(width: 8),
                      _trailing(context, scheme, state.isFavorite(chat.id)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _preview(
      BuildContext context, AppState state, Message? last, bool typing) {
    final scheme = Theme.of(context).colorScheme;
    if (typing) {
      return Text(
        'tippt …',
        style: TextStyle(
          color: scheme.primary,
          fontStyle: FontStyle.italic,
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
      );
    }
    // An unsent draft outranks the last message — you see at a glance where
    // you stopped writing.
    final draft = state.draftFor(chat.id);
    if (draft.isNotEmpty) {
      return Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: 'Entwurf: ',
              style: TextStyle(
                  color: scheme.error, fontWeight: FontWeight.w700),
            ),
            TextSpan(
              text: draft,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 14),
      );
    }
    if (last == null) {
      return Text(
        'Noch keine Nachrichten — sag Hallo!',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14),
      );
    }

    // Privacy: optionally hide the last-message text in the chat list while
    // still hinting that something is there.
    if (state.settings.hideListPreview && !last.isSystem && !last.deleted) {
      return Text(
        chat.unread > 0 ? 'Neue Nachricht' : 'Nachricht',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
            color: scheme.onSurfaceVariant,
            fontSize: 14,
            fontStyle: FontStyle.italic),
      );
    }

    String text;
    if (last.isSystem) {
      text = last.body;
    } else if (last.deleted) {
      text = 'Nachricht gelöscht';
    } else {
      final mine = last.senderId == state.me?.id;
      final prefix = mine
          ? (chat.self ? '' : 'Du: ')
          : (chat.isGroup
              ? '${state.cachedUser(last.senderId ?? '')?.displayName.split(' ').first ?? ''}: '
              : '');
      // preview falls back to the body for text and labels media ("📷 Foto"),
      // so attachments without a caption don't render as an empty line.
      text = '$prefix${last.preview}';
    }

    final isMine = last.senderId == state.me?.id;
    return Row(
      children: [
        if (isMine && !last.isSystem && !last.deleted) ...[
          ReceiptTicks(status: last.status, size: 15),
          const SizedBox(width: 4),
        ],
        Expanded(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: last.deleted
                  ? scheme.onSurfaceVariant.withValues(alpha: 0.7)
                  : scheme.onSurfaceVariant,
              fontSize: 14,
              fontStyle: last.deleted ? FontStyle.italic : FontStyle.normal,
            ),
          ),
        ),
      ],
    );
  }

  Widget _trailing(BuildContext context, ColorScheme scheme, bool favorite) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (favorite)
          const Padding(
            padding: EdgeInsets.only(right: 6),
            child: Icon(Icons.star_rounded, size: 15, color: Color(0xFFFFB300)),
          ),
        if (pinned)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Transform.rotate(
              angle: 0.7,
              child: Icon(Icons.push_pin_rounded,
                  size: 15, color: scheme.onSurfaceVariant),
            ),
          ),
        if (chat.muted)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Icon(Icons.notifications_off_rounded,
                size: 16, color: scheme.onSurfaceVariant),
          ),
        if (chat.unread > 0)
          Container(
            constraints: const BoxConstraints(minWidth: 22),
            height: 22,
            padding: const EdgeInsets.symmetric(horizontal: 7),
            decoration: BoxDecoration(
              color: chat.muted ? scheme.outline : scheme.primary,
              borderRadius: BorderRadius.circular(11),
            ),
            alignment: Alignment.center,
            child: Text(
              chat.unread > 99 ? '99+' : '${chat.unread}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    );
  }
}
