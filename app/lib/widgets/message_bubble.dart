import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/message.dart';
import '../services/audio_player_service.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../utils/message_format.dart';
import 'receipt_ticks.dart';
import 'verified_badge.dart';

/// A single chat bubble, WhatsApp-style: mine on the right in a tinted blue,
/// others on the left in a light surface, with the time + ticks tucked into the
/// bottom corner. Renders text, images/GIFs, voice notes and file attachments.
class MessageBubble extends StatelessWidget {
  final Message message;
  final bool isMine;
  final bool showSenderName;
  final String? senderName;
  final Color senderColor;

  /// A trust badge to show beside the sender name in groups (verified/premium).
  final BadgeKind? senderBadge;

  /// This bubble is an official "Ping Team" broadcast → branded, unmistakable
  /// styling with a header seal.
  final bool official;
  final Message? repliedTo;
  final String? repliedToSender;
  final VoidCallback? onLongPress;
  final VoidCallback? onSwipeReply;

  /// Double-tap the bubble — quick ❤️ reaction (like Instagram/iMessage).
  final VoidCallback? onDoubleTap;

  /// This message is bookmarked → show a little star in the footer.
  final bool starred;

  /// Tapped the reply quote — jump to the original message.
  final VoidCallback? onTapQuote;

  /// Briefly highlighted because we just jumped to it.
  final bool highlighted;

  // Media plumbing (all optional so the widget renders fine in tests).
  final String Function(String relativeUrl)? resolveUrl;
  final Map<String, String>? mediaHeaders;
  final AudioController? audio;
  final void Function(Attachment att)? onOpenImage;
  final void Function(Attachment att)? onOpenFile;
  final void Function(Attachment att)? onPlayAudio;
  final void Function(Attachment att)? onOpenVideo;
  final double textScale;

  /// Tapped an existing reaction chip → toggle that emoji for me.
  final void Function(String emoji)? onToggleReaction;

  /// Tapped a poll option — toggle my vote for it.
  final void Function(int option)? onVotePoll;

  const MessageBubble({
    super.key,
    required this.message,
    required this.isMine,
    this.showSenderName = false,
    this.senderName,
    this.senderColor = Colors.indigo,
    this.senderBadge,
    this.official = false,
    this.repliedTo,
    this.repliedToSender,
    this.onLongPress,
    this.onSwipeReply,
    this.onDoubleTap,
    this.starred = false,
    this.onTapQuote,
    this.highlighted = false,
    this.resolveUrl,
    this.mediaHeaders,
    this.audio,
    this.onOpenImage,
    this.onOpenFile,
    this.onPlayAudio,
    this.onOpenVideo,
    this.textScale = 1.0,
    this.onToggleReaction,
    this.onVotePoll,
  });

  @override
  Widget build(BuildContext context) {
    if (message.isSystem) return _SystemBubble(text: message.body);

    final palette = context.ping;
    final scheme = Theme.of(context).colorScheme;
    final bg = isMine ? palette.bubbleOut : palette.bubbleIn;
    final fg = isMine ? palette.bubbleOutText : palette.bubbleInText;
    const radius = Radius.circular(18);
    const tailRadius = Radius.circular(3);

    final hasMedia = message.attachment != null && !message.deleted;
    final hasPoll = message.poll != null && !message.deleted;
    final hasText = message.body.trim().isNotEmpty;
    // Emoji-only messages render large and bubble-less, like a sticker.
    final jumbo = !hasMedia && message.isEmojiOnly && repliedTo == null;
    // An incoming official "Ping Team" broadcast → branded, trustworthy bubble.
    final officialIn = official && !isMine && !jumbo;

    // A whisper of the accent at the tail corner gives my own bubbles depth —
    // the difference between a flat box and something that feels designed.
    final tailColor =
        isMine ? (Color.lerp(bg, scheme.secondary, 0.16) ?? bg) : bg;
    final gradient = (isMine && !jumbo)
        ? LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [bg, tailColor],
          )
        : null;

    final bubble = Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.80,
      ),
      padding:
          EdgeInsets.fromLTRB(hasMedia ? 5 : 12, 7, hasMedia ? 5 : 12, 7),
      decoration: BoxDecoration(
        color: jumbo
            ? Colors.transparent
            : officialIn
                ? (Color.lerp(bg, scheme.primary, 0.07) ?? bg)
                : (gradient == null ? bg : null),
        gradient: gradient,
        border: officialIn
            ? Border.all(
                color: scheme.primary.withValues(alpha: 0.45), width: 1.2)
            : null,
        borderRadius: BorderRadius.only(
          topLeft: radius,
          topRight: radius,
          bottomLeft: isMine ? radius : tailRadius,
          bottomRight: isMine ? tailRadius : radius,
        ),
        boxShadow: jumbo
            ? null
            : [
                BoxShadow(
                  color: officialIn
                      ? scheme.primary.withValues(alpha: 0.18)
                      : Colors.black.withValues(alpha: 0.10),
                  blurRadius: officialIn ? 8 : 4,
                  offset: const Offset(0, 1.5),
                ),
              ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (officialIn)
            Padding(
              padding: EdgeInsets.fromLTRB(hasMedia ? 6 : 0, 1, 0, 5),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const PingBadge(kind: BadgeKind.official, size: 15),
                  const SizedBox(width: 5),
                  Text(
                    'Ping-Team',
                    style: TextStyle(
                      color: scheme.primary,
                      fontWeight: FontWeight.w800,
                      fontSize: 12.5,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ),
          if (showSenderName && !isMine)
            Padding(
              padding: EdgeInsets.fromLTRB(hasMedia ? 6 : 0, 1, 0, 3),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      senderName ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: senderColor,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  if (senderBadge != null) ...[
                    const SizedBox(width: 4),
                    PingBadge(kind: senderBadge!, size: 13),
                  ],
                ],
              ),
            ),
          if (repliedTo != null)
            Padding(
              padding: EdgeInsets.symmetric(horizontal: hasMedia ? 6 : 0),
              child: _ReplyQuote(
                message: repliedTo!,
                sender: repliedToSender,
                mine: isMine,
                onTap: onTapQuote,
              ),
            ),
          if (hasMedia) _media(context, fg),
          if (hasPoll)
            _PollContent(
              poll: message.poll!,
              fg: fg,
              textScale: textScale,
              onVote: onVotePoll,
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
          else if (hasText)
            Padding(
              padding: EdgeInsets.fromLTRB(
                  hasMedia ? 6 : 0, hasMedia ? 6 : 0, hasMedia ? 6 : 0, 0),
              child: jumbo
                  ? Text(
                      message.body,
                      style: TextStyle(
                          color: fg, fontSize: 44 * textScale, height: 1.1),
                    )
                  : FormattedMessageText(
                      text: message.body,
                      style: TextStyle(
                          color: fg, fontSize: 15.5 * textScale, height: 1.3),
                    ),
            ),
          Padding(
            padding:
                EdgeInsets.fromLTRB(hasMedia ? 6 : 0, 2, hasMedia ? 4 : 0, 0),
            child: _footer(fg),
          ),
        ],
      ),
    );

    // A little painted tail flick tucked into the bottom corner — the detail
    // that reads as "real chat app" rather than a generic list of boxes.
    final withTail = jumbo
        ? bubble
        : Stack(
            clipBehavior: Clip.none,
            children: [
              bubble,
              Positioned(
                bottom: 0,
                left: isMine ? null : -6,
                right: isMine ? -6 : null,
                child: CustomPaint(
                  size: const Size(9, 14),
                  painter: _BubbleTail(color: tailColor, mine: isMine),
                ),
              ),
            ],
          );

    final content = AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 9),
      color: highlighted
          ? scheme.primary.withValues(alpha: 0.16)
          : Colors.transparent,
      child: Align(
        alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment:
              isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            GestureDetector(
              onLongPress: onLongPress,
              onDoubleTap: onDoubleTap,
              child: withTail,
            ),
            if (message.hasReactions && !message.deleted)
              _ReactionChips(
                message: message,
                isMine: isMine,
                onToggle: onToggleReaction,
              ),
          ],
        ),
      ),
    );

    if (onSwipeReply == null || message.deleted) return content;
    return _SwipeToReply(onReply: onSwipeReply!, child: content);
  }

  Widget _footer(Color fg) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (starred)
          Padding(
            padding: const EdgeInsets.only(right: 5),
            child: Icon(Icons.star_rounded,
                size: 13, color: fg.withValues(alpha: 0.8)),
          ),
        if (message.isEdited)
          Padding(
            padding: const EdgeInsets.only(right: 5),
            child: Text(
              'bearbeitet',
              style: TextStyle(color: fg.withValues(alpha: 0.6), fontSize: 11),
            ),
          ),
        if (message.expiresAt != null)
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: Icon(Icons.timer_outlined,
                size: 12, color: fg.withValues(alpha: 0.65)),
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
    if (att.kind == 'video') {
      return _VideoAttachment(att: att, onTap: () => onOpenVideo?.call(att));
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

class _VideoAttachment extends StatelessWidget {
  final Attachment att;
  final VoidCallback onTap;
  const _VideoAttachment({required this.att, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: 240,
          height: 150,
          color: Colors.black87,
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(Icons.play_circle_fill_rounded,
                  color: Colors.white, size: 56),
              Positioned(
                left: 8,
                bottom: 8,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.videocam_rounded,
                          color: Colors.white, size: 14),
                      const SizedBox(width: 4),
                      Text(
                        att.name ?? 'Video',
                        style: const TextStyle(
                            color: Colors.white, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
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

/// The body of a poll message: question, tappable answer rows with live result
/// bars, and a voter count. Tapping an option toggles the viewer's vote.
class _PollContent extends StatelessWidget {
  final PollData poll;
  final Color fg;
  final double textScale;
  final void Function(int option)? onVote;
  const _PollContent({
    required this.poll,
    required this.fg,
    required this.textScale,
    this.onVote,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final total = poll.totalVotes;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 230, maxWidth: 270),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.poll_rounded, size: 18, color: scheme.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  poll.question,
                  style: TextStyle(
                    color: fg,
                    fontWeight: FontWeight.w700,
                    fontSize: 15 * textScale,
                    height: 1.25,
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 24, top: 1, bottom: 6),
            child: Text(
              poll.multi ? 'Mehrere Antworten möglich' : 'Eine Antwort möglich',
              style: TextStyle(color: fg.withValues(alpha: 0.6), fontSize: 11),
            ),
          ),
          for (var i = 0; i < poll.options.length; i++)
            _option(context, scheme, i, total),
          const SizedBox(height: 2),
          Text(
            poll.totalVoters == 0
                ? 'Noch keine Stimmen — tippe zum Abstimmen'
                : poll.totalVoters == 1
                    ? '1 Person hat abgestimmt'
                    : '${poll.totalVoters} Personen haben abgestimmt',
            style: TextStyle(color: fg.withValues(alpha: 0.6), fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _option(BuildContext context, ColorScheme scheme, int i, int total) {
    final opt = poll.options[i];
    final mine = poll.myVotes.contains(i);
    final share = total == 0 ? 0.0 : opt.votes / total;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onVote == null ? null : () => onVote!(i),
        child: Stack(
          children: [
            // Result bar filling from the left as votes come in.
            Positioned.fill(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: AnimatedFractionallySizedBox(
                    duration: const Duration(milliseconds: 350),
                    curve: Curves.easeOut,
                    widthFactor: share.clamp(0.0, 1.0),
                    heightFactor: 1,
                    child: Container(
                      color: scheme.primary
                          .withValues(alpha: mine ? 0.30 : 0.16),
                    ),
                  ),
                ),
              ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: mine
                      ? scheme.primary.withValues(alpha: 0.75)
                      : fg.withValues(alpha: 0.25),
                  width: mine ? 1.4 : 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    mine
                        ? Icons.check_circle_rounded
                        : Icons.radio_button_unchecked_rounded,
                    size: 17,
                    color: mine ? scheme.primary : fg.withValues(alpha: 0.5),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      opt.text,
                      style: TextStyle(
                        color: fg,
                        fontSize: 13.5 * textScale,
                        fontWeight: mine ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '${opt.votes}',
                    style: TextStyle(
                      color: fg.withValues(alpha: 0.75),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
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
  final VoidCallback? onTap;
  const _ReplyQuote(
      {required this.message, this.sender, required this.mine, this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = scheme.primary;
    final base = mine ? context.ping.bubbleOutText : context.ping.bubbleInText;
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
      ),
    );
  }
}

/// The little emoji-reaction pills shown just under a bubble. The viewer's own
/// reactions are highlighted; tapping one toggles it.
class _ReactionChips extends StatelessWidget {
  final Message message;
  final bool isMine;
  final void Function(String emoji)? onToggle;
  const _ReactionChips({
    required this.message,
    required this.isMine,
    this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final entries = message.reactions.entries.toList();
    return Padding(
      padding: const EdgeInsets.only(left: 12, right: 12, top: 2, bottom: 2),
      child: Wrap(
        spacing: 5,
        runSpacing: 4,
        alignment: isMine ? WrapAlignment.end : WrapAlignment.start,
        children: [
          for (final e in entries)
            GestureDetector(
              onTap: onToggle == null ? null : () => onToggle!(e.key),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: message.myReactions.contains(e.key)
                      ? scheme.primary.withValues(alpha: 0.22)
                      : scheme.surfaceContainerHighest.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: message.myReactions.contains(e.key)
                        ? scheme.primary.withValues(alpha: 0.7)
                        : scheme.outlineVariant.withValues(alpha: 0.4),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(e.key, style: const TextStyle(fontSize: 13)),
                    if (e.value > 1) ...[
                      const SizedBox(width: 3),
                      Text(
                        '${e.value}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Swipe a bubble to the right to reply — the gesture WhatsApp users reach for
/// instinctively. A reply glyph fades in as you drag and the action fires past a
/// threshold, then the bubble springs back.
class _SwipeToReply extends StatefulWidget {
  final Widget child;
  final VoidCallback onReply;
  const _SwipeToReply({required this.child, required this.onReply});

  @override
  State<_SwipeToReply> createState() => _SwipeToReplyState();
}

class _SwipeToReplyState extends State<_SwipeToReply> {
  static const _trigger = 56.0;
  double _dx = 0;
  bool _fired = false;

  void _update(DragUpdateDetails d) {
    setState(() {
      _dx = (_dx + d.delta.dx).clamp(0.0, 96.0);
      if (_dx >= _trigger && !_fired) {
        _fired = true;
        HapticFeedback.selectionClick();
      } else if (_dx < _trigger) {
        _fired = false;
      }
    });
  }

  void _end(DragEndDetails _) {
    if (_dx >= _trigger) widget.onReply();
    setState(() {
      _dx = 0;
      _fired = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final progress = (_dx / _trigger).clamp(0.0, 1.0);
    return GestureDetector(
      onHorizontalDragUpdate: _update,
      onHorizontalDragEnd: _end,
      child: Stack(
        children: [
          Positioned(
            left: 18,
            top: 0,
            bottom: 0,
            child: Center(
              child: Opacity(
                opacity: progress,
                child: Transform.scale(
                  scale: 0.6 + 0.4 * progress,
                  child: Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: scheme.primary.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.reply_rounded,
                        size: 18, color: scheme.primary),
                  ),
                ),
              ),
            ),
          ),
          AnimatedContainer(
            duration:
                _dx == 0 ? const Duration(milliseconds: 180) : Duration.zero,
            curve: Curves.easeOut,
            transform: Matrix4.translationValues(_dx, 0, 0),
            child: widget.child,
          ),
        ],
      ),
    );
  }
}

/// The small curved tail flick tucked into a bubble's bottom corner.
class _BubbleTail extends CustomPainter {
  final Color color;
  final bool mine;
  const _BubbleTail({required this.color, required this.mine});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;
    final w = size.width;
    final h = size.height;
    final path = Path();
    if (mine) {
      path.moveTo(0, 0);
      path.quadraticBezierTo(0, h * 0.78, w, h);
      path.quadraticBezierTo(w * 0.42, h * 0.55, 0, h * 0.42);
    } else {
      path.moveTo(w, 0);
      path.quadraticBezierTo(w, h * 0.78, 0, h);
      path.quadraticBezierTo(w * 0.58, h * 0.55, w, h * 0.42);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_BubbleTail old) => old.color != color || old.mine != mine;
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
