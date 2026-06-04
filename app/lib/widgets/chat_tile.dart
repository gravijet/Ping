import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/message.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import 'avatar.dart';
import 'receipt_ticks.dart';

class ChatTile extends StatelessWidget {
  final Chat chat;
  final VoidCallback onTap;

  const ChatTile({super.key, required this.chat, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final state = context.watch<AppState>();
    final last = chat.lastMessage;
    final typing = chat.isGroup
        ? state.typingIn(chat.id).isNotEmpty
        : (chat.otherUser != null &&
            state.typingIn(chat.id).contains(chat.otherUser!.id));

    final online = !chat.isGroup &&
        chat.otherUser != null &&
        state.isOnline(chat.otherUser!.id);

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            PingAvatar(
              initials: chat.initials,
              color: chat.color,
              size: 54,
              online: chat.isGroup ? null : online,
              icon: chat.isGroup ? Icons.groups_rounded : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          chat.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
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
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(child: _preview(context, state, last, typing)),
                      const SizedBox(width: 8),
                      _trailing(context, scheme),
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
    if (last == null) {
      return Text(
        'Noch keine Nachrichten — sag Hallo!',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14),
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
          ? 'Du: '
          : (chat.isGroup
              ? '${state.cachedUser(last.senderId ?? '')?.displayName.split(' ').first ?? ''}: '
              : '');
      text = '$prefix${last.body}';
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

  Widget _trailing(BuildContext context, ColorScheme scheme) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
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
