import 'package:flutter/material.dart';

import '../models/message.dart';
import '../utils/format.dart';
import 'receipt_ticks.dart';

/// A single chat bubble. Mine sit on the right with the primary colour; others
/// on the left in a neutral surface. Supports a quoted reply preview.
class MessageBubble extends StatelessWidget {
  final Message message;
  final bool isMine;
  final bool showSenderName;
  final String? senderName;
  final Color senderColor;
  final Message? repliedTo;
  final String? repliedToSender;
  final VoidCallback? onLongPress;
  final VoidCallback? onSwipeReply;

  const MessageBubble({
    super.key,
    required this.message,
    required this.isMine,
    this.showSenderName = false,
    this.senderName,
    this.senderColor = Colors.indigo,
    this.repliedTo,
    this.repliedToSender,
    this.onLongPress,
    this.onSwipeReply,
  });

  @override
  Widget build(BuildContext context) {
    if (message.isSystem) return _SystemBubble(text: message.body);

    final scheme = Theme.of(context).colorScheme;
    final bg = isMine ? scheme.primary : scheme.surfaceContainerHighest;
    final fg = isMine ? scheme.onPrimary : scheme.onSurface;
    final radius = Radius.circular(20);

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78,
          ),
          margin: const EdgeInsets.symmetric(vertical: 2, horizontal: 10),
          padding: const EdgeInsets.fromLTRB(14, 9, 14, 7),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.only(
              topLeft: radius,
              topRight: radius,
              bottomLeft: isMine ? radius : const Radius.circular(5),
              bottomRight: isMine ? const Radius.circular(5) : radius,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (showSenderName && !isMine)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(
                    senderName ?? '',
                    style: TextStyle(
                      color: senderColor,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
              if (repliedTo != null)
                _ReplyQuote(
                  message: repliedTo!,
                  sender: repliedToSender,
                  mine: isMine,
                ),
              if (message.deleted)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.block_rounded,
                        size: 16, color: fg.withValues(alpha: 0.7)),
                    const SizedBox(width: 6),
                    Text(
                      'Diese Nachricht wurde gelöscht',
                      style: TextStyle(
                        color: fg.withValues(alpha: 0.7),
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                )
              else
                Text(
                  message.body,
                  style: TextStyle(color: fg, fontSize: 15.5, height: 1.3),
                ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (message.isEdited)
                    Padding(
                      padding: const EdgeInsets.only(right: 5),
                      child: Text(
                        'bearbeitet',
                        style: TextStyle(
                          color: fg.withValues(alpha: 0.6),
                          fontSize: 11,
                        ),
                      ),
                    ),
                  Text(
                    TimeFormat.messageTime(message.time),
                    style: TextStyle(
                      color: fg.withValues(alpha: 0.7),
                      fontSize: 11,
                    ),
                  ),
                  if (isMine && !message.deleted) ...[
                    const SizedBox(width: 4),
                    ReceiptTicks(
                      status: message.status,
                      size: 15,
                      color: message.status == MessageStatus.read
                          ? null
                          : fg.withValues(alpha: 0.8),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReplyQuote extends StatelessWidget {
  final Message message;
  final String? sender;
  final bool mine;
  const _ReplyQuote({required this.message, this.sender, required this.mine});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = mine ? scheme.onPrimary : scheme.primary;
    final base = mine ? scheme.onPrimary : scheme.onSurface;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
      decoration: BoxDecoration(
        color: (mine ? scheme.onPrimary : scheme.primary)
            .withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border(left: BorderSide(color: accent, width: 3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            sender ?? 'Antwort',
            style: TextStyle(
                color: accent, fontWeight: FontWeight.w700, fontSize: 12),
          ),
          const SizedBox(height: 1),
          Text(
            message.deleted ? 'Gelöschte Nachricht' : message.body,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                color: base.withValues(alpha: 0.85), fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _SystemBubble extends StatelessWidget {
  final String text;
  const _SystemBubble({required this.text});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 40),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.7),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: scheme.onSurfaceVariant,
            fontSize: 12.5,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
