import 'package:flutter/material.dart';

import '../models/message.dart';
import '../services/audio_player_service.dart';
import '../theme.dart';
import '../utils/format.dart';
import 'receipt_ticks.dart';

/// A single chat bubble, WhatsApp-style: mine on the right in a tinted blue,
/// others on the left in a light surface, with the time + ticks tucked into the
/// bottom corner. Renders text, images/GIFs, voice notes and file attachments.
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

  // Media plumbing (all optional so the widget renders fine in tests).
  final String Function(String relativeUrl)? resolveUrl;
  final Map<String, String>? mediaHeaders;
  final AudioController? audio;
  final void Function(Attachment att)? onOpenImage;
  final void Function(Attachment att)? onOpenFile;
  final void Function(Attachment att)? onPlayAudio;
  final double textScale;

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
    this.resolveUrl,
    this.mediaHeaders,
    this.audio,
    this.onOpenImage,
    this.onOpenFile,
    this.onPlayAudio,
    this.textScale = 1.0,
  });

  @override
  Widget build(BuildContext context) {
    if (message.isSystem) return _SystemBubble(text: message.body);

    final palette = context.ping;
    final bg = isMine ? palette.bubbleOut : palette.bubbleIn;
    final fg = isMine ? palette.bubbleOutText : palette.bubbleInText;
    const radius = Radius.circular(16);

    final hasMedia = message.attachment != null && !message.deleted;
    final hasText = message.body.trim().isNotEmpty;

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.80,
          ),
          margin: const EdgeInsets.symmetric(vertical: 2, horizontal: 9),
          padding: EdgeInsets.fromLTRB(
              hasMedia ? 5 : 11, 6, hasMedia ? 5 : 11, 6),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.only(
              topLeft: radius,
              topRight: radius,
              bottomLeft: isMine ? radius : const Radius.circular(4),
              bottomRight: isMine ? const Radius.circular(4) : radius,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 1.5,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showSenderName && !isMine)
                Padding(
                  padding: EdgeInsets.fromLTRB(hasMedia ? 6 : 0, 1, 0, 3),
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
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: hasMedia ? 6 : 0),
                  child: _ReplyQuote(
                    message: repliedTo!,
                    sender: repliedToSender,
                    mine: isMine,
                  ),
                ),
              if (hasMedia) _media(context, fg),
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
              else if (hasText)
                Padding(
                  padding: EdgeInsets.fromLTRB(
                      hasMedia ? 6 : 0, hasMedia ? 6 : 0, hasMedia ? 6 : 0, 0),
                  child: Text(
                    message.body,
                    style: TextStyle(
                        color: fg, fontSize: 15.5 * textScale, height: 1.3),
                  ),
                ),
              Padding(
                padding: EdgeInsets.fromLTRB(hasMedia ? 6 : 0, 2, hasMedia ? 4 : 0, 0),
                child: _footer(fg),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _footer(Color fg) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (message.isEdited)
          Padding(
            padding: const EdgeInsets.only(right: 5),
            child: Text(
              'bearbeitet',
              style: TextStyle(color: fg.withValues(alpha: 0.6), fontSize: 11),
            ),
          ),
        Text(
          TimeFormat.messageTime(message.time),
          style: TextStyle(color: fg.withValues(alpha: 0.7), fontSize: 11),
        ),
        if (isMine && !message.deleted) ...[
          const SizedBox(width: 4),
          // ReceiptTicks paints the read state blue itself; for the other
          // states we tint with the bubble's foreground colour.
          ReceiptTicks(
            status: message.status,
            size: 15,
            color: fg.withValues(alpha: 0.8),
          ),
        ],
      ],
    );
  }

  Widget _media(BuildContext context, Color fg) {
    final att = message.attachment!;
    if (att.isImage) {
      return _ImageAttachment(
        att: att,
        url: resolveUrl?.call(att.url),
        headers: mediaHeaders,
        onTap: () => onOpenImage?.call(att),
      );
    }
    if (att.isAudio) {
      return _VoiceAttachment(
        att: att,
        audio: audio,
        mine: isMine,
        onTap: () => onPlayAudio?.call(att),
      );
    }
    return _FileAttachment(att: att, fg: fg, onTap: () => onOpenFile?.call(att));
  }
}

class _ImageAttachment extends StatelessWidget {
  final Attachment att;
  final String? url;
  final Map<String, String>? headers;
  final VoidCallback onTap;
  const _ImageAttachment({
    required this.att,
    required this.url,
    required this.headers,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 260,
            maxHeight: 320,
            minWidth: 140,
            minHeight: 90,
          ),
          child: url == null
              ? _placeholder(context)
              : Image.network(
                  url!,
                  headers: headers,
                  fit: BoxFit.cover,
                  loadingBuilder: (ctx, child, progress) =>
                      progress == null ? child : _placeholder(ctx),
                  errorBuilder: (ctx, _, _) => _placeholder(ctx, error: true),
                ),
        ),
      ),
    );
  }

  Widget _placeholder(BuildContext context, {bool error = false}) {
    return Container(
      width: 220,
      height: 160,
      color: Colors.black.withValues(alpha: 0.06),
      child: Center(
        child: Icon(
          error ? Icons.broken_image_rounded : Icons.image_rounded,
          color: Colors.black.withValues(alpha: 0.3),
          size: 36,
        ),
      ),
    );
  }
}

class _VoiceAttachment extends StatelessWidget {
  final Attachment att;
  final AudioController? audio;
  final bool mine;
  final VoidCallback onTap;
  const _VoiceAttachment({
    required this.att,
    required this.audio,
    required this.mine,
    required this.onTap,
  });

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString();
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = mine ? scheme.primary : scheme.primary;
    final total = att.durationMs != null
        ? Duration(milliseconds: att.durationMs!)
        : Duration.zero;

    Widget body(bool playing, double progress, Duration pos) => Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, 10, 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                onPressed: onTap,
                icon: Icon(
                  playing
                      ? Icons.pause_circle_filled_rounded
                      : Icons.play_circle_fill_rounded,
                  color: accent,
                  size: 38,
                ),
              ),
              SizedBox(
                width: 130,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LinearProgressIndicator(
                      value: progress.clamp(0.0, 1.0),
                      minHeight: 3,
                      backgroundColor: accent.withValues(alpha: 0.2),
                      color: accent,
                    ),
                    const SizedBox(height: 5),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Icon(Icons.mic_rounded, size: 14),
                        Text(
                          _fmt(playing && pos > Duration.zero ? pos : total),
                          style: const TextStyle(fontSize: 11),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );

    if (audio == null) return body(false, 0, Duration.zero);
    return AnimatedBuilder(
      animation: audio!,
      builder: (context, _) {
        final current = audio!.isCurrent(att.url);
        final playing = current && audio!.playing;
        final dur = current && audio!.duration > Duration.zero
            ? audio!.duration
            : total;
        final pos = current ? audio!.position : Duration.zero;
        final progress = dur.inMilliseconds == 0
            ? 0.0
            : pos.inMilliseconds / dur.inMilliseconds;
        return body(playing, progress, pos);
      },
    );
  }
}

class _FileAttachment extends StatelessWidget {
  final Attachment att;
  final Color fg;
  final VoidCallback onTap;
  const _FileAttachment(
      {required this.att, required this.fg, required this.onTap});

  String _size(int? bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isVideo = att.kind == 'video';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 230,
        padding: const EdgeInsets.all(8),
        margin: const EdgeInsets.symmetric(horizontal: 2),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                isVideo ? Icons.play_circle_outline_rounded : Icons.description_rounded,
                color: scheme.primary,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    att.name ?? (isVideo ? 'Video' : 'Datei'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: fg, fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _size(att.size),
                    style: TextStyle(color: fg.withValues(alpha: 0.6), fontSize: 12),
                  ),
                ],
              ),
            ),
            Icon(Icons.download_rounded, color: fg.withValues(alpha: 0.7), size: 20),
          ],
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
    final accent = scheme.primary;
    final base = mine ? context.ping.bubbleOutText : context.ping.bubbleInText;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
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
            message.deleted ? 'Gelöschte Nachricht' : message.preview,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style:
                TextStyle(color: base.withValues(alpha: 0.85), fontSize: 13),
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
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.85),
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
