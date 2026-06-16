import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';

import '../platform.dart';
import '../models/status.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/speed_badge.dart';
import '../widgets/verified_badge.dart';

/// Full-screen story viewer that steps through one or more contacts' statuses
/// with timed progress bars, tap-to-advance and (for your own) a viewer count.
class StatusViewerScreen extends StatefulWidget {
  final List<StatusGroup> groups;
  final int initialGroup;
  final bool mine;

  const StatusViewerScreen({
    super.key,
    required this.groups,
    this.initialGroup = 0,
    this.mine = false,
  });

  @override
  State<StatusViewerScreen> createState() => _StatusViewerScreenState();
}

class _StatusViewerScreenState extends State<StatusViewerScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _progress;
  int _group = 0;
  int _item = 0;
  // Drives the top bar for video items (images/text use [_progress]).
  double _videoProgress = 0;
  final TextEditingController _replyCtrl = TextEditingController();
  final FocusNode _replyFocus = FocusNode();

  bool _isVideo(PingStatus s) => s.isVideo || s.attachment?.kind == 'video';

  // video_player has no Windows implementation, so on desktop a video status is
  // shown as a placeholder and advanced by the normal 5s timer (like an image)
  // rather than driving its own playback-based progress.
  bool _playableVideo(PingStatus s) => _isVideo(s) && !isDesktopPlatform;

  @override
  void initState() {
    super.initState();
    _group = widget.initialGroup.clamp(0, widget.groups.length - 1);
    // Begin at the first status this person posted that we haven't watched yet,
    // so re-opening (or a freshly added status) doesn't replay the old ones.
    _item = widget.mine ? 0 : widget.groups[_group].firstUnseen;
    _progress = AnimationController(vsync: this, duration: const Duration(seconds: 5))
      ..addStatusListener((s) {
        if (s == AnimationStatus.completed) _next();
      });
    // Pause the story while the reply field is focused; resume when it isn't.
    _replyFocus.addListener(() {
      if (_replyFocus.hasFocus) {
        _progress.stop();
      } else if (mounted && !_playableVideo(_current)) {
        _progress.forward();
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  StatusGroup get _currentGroup => widget.groups[_group];
  PingStatus get _current => _currentGroup.items[_item];

  void _start() {
    if (!widget.mine) {
      context.read<AppState>().markStatusViewed(_current.id);
    }
    _videoProgress = 0;
    _progress.reset();
    // Videos drive their own progress bar and advance when they finish; only
    // text/image use the fixed 5-second timer.
    if (!_playableVideo(_current)) _progress.forward();
  }

  void _next() {
    if (_item < _currentGroup.items.length - 1) {
      setState(() => _item++);
      _start();
    } else {
      // Last status of this person → stop showing (don't jump to someone else).
      Navigator.of(context).maybePop();
    }
  }

  void _prev() {
    // Stay within this person; at the first item just restart it.
    if (_item > 0) {
      setState(() => _item--);
    }
    _start();
  }

  // Resume the timed progress after a sheet/dialog (no-op for videos).
  void _resume() {
    if (!_playableVideo(_current)) _progress.forward();
  }

  Future<void> _showViewers() async {
    _progress.stop();
    final state = context.read<AppState>();
    final id = _current.id;
    try {
      final viewers = await state.statusViewers(id);
      if (!mounted) return;
      await showModalBottomSheet(
        context: context,
        showDragHandle: true,
        builder: (_) => SafeArea(
          child: viewers.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(28),
                  child: Text('Noch niemand hat diesen Status gesehen.'),
                )
              : ListView(
                  shrinkWrap: true,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                      child: Text('Gesehen von ${viewers.length}',
                          style: Theme.of(context).textTheme.titleMedium),
                    ),
                    for (final v in viewers)
                      ListTile(
                        leading: PingAvatar(
                          initials: v.user.initials,
                          color: v.user.color,
                          size: 42,
                          imageUrl: state.avatarUrl(v.user),
                          imageHeaders: state.authHeaders,
                        ),
                        title: NameWithBadge(name: v.user.label, user: v.user),
                        subtitle: Text(TimeFormat.messageTime(
                            DateTime.fromMillisecondsSinceEpoch(v.viewedAt))),
                      ),
                  ],
                ),
        ),
      );
    } catch (_) {
      /* ignore */
    }
    if (mounted) _resume();
  }

  Future<void> _delete() async {
    _progress.stop();
    final state = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Status löschen?'),
        content: const Text('Dieser Status wird sofort entfernt.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Löschen'),
          ),
        ],
      ),
    );
    if (ok != true) {
      if (mounted) _resume();
      return;
    }
    await state.deleteStatus(_current.id);
    if (mounted) Navigator.of(context).maybePop();
  }

  Future<void> _sendReply() async {
    final text = _replyCtrl.text.trim();
    if (text.isEmpty) return;
    final state = context.read<AppState>();
    final owner = _currentGroup.user;
    _replyCtrl.clear();
    _replyFocus.unfocus();
    try {
      await state.replyToStatus(owner, text);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Antwort an ${owner.label} gesendet')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Antwort konnte nicht gesendet werden')),
        );
      }
    }
  }

  /// Tap a quick-reaction emoji → sends it as a status reply (a DM).
  Future<void> _quickReact(String emoji) async {
    final state = context.read<AppState>();
    final owner = _currentGroup.user;
    try {
      await state.replyToStatus(owner, emoji);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$emoji an ${owner.label} gesendet')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reaktion konnte nicht gesendet werden')),
        );
      }
    }
  }

  @override
  void dispose() {
    _replyCtrl.dispose();
    _replyFocus.dispose();
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final status = _current;
    final group = _currentGroup;

    return Scaffold(
      backgroundColor: status.isMedia ? Colors.black : status.background,
      body: GestureDetector(
        // Opaque so a tap anywhere — including on a plain text status, where the
        // empty area around the text would otherwise miss — advances the story.
        behavior: HitTestBehavior.opaque,
        onTapUp: (d) {
          final w = MediaQuery.of(context).size.width;
          // A tap anywhere advances to the next status; only a thin left edge
          // goes back, so single-tapping reliably moves forward to the end.
          if (d.globalPosition.dx < w * 0.15) {
            _prev();
          } else {
            _next();
          }
        },
        child: Stack(
          children: [
            Positioned.fill(child: _content(state, status)),
            // Progress bars
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                child: Column(
                  children: [
                    Row(
                      children: [
                        for (var i = 0; i < group.items.length; i++)
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 2),
                              child: _bar(i),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    _header(state, group, status),
                  ],
                ),
              ),
            ),
            if (widget.mine)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        TextButton.icon(
                          style: TextButton.styleFrom(
                              foregroundColor: Colors.white),
                          onPressed: _showViewers,
                          icon: const Icon(Icons.visibility_rounded),
                          label: Text('${status.viewCount ?? 0}'),
                        ),
                        const SizedBox(width: 20),
                        TextButton.icon(
                          style: TextButton.styleFrom(
                              foregroundColor: Colors.white),
                          onPressed: _delete,
                          icon: const Icon(Icons.delete_outline_rounded),
                          label: const Text('Löschen'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            // Reply to someone else's status → opens a DM with them. Not shown
            // for the official Ping-Team channel (it's read-only).
            if (!widget.mine && !group.user.official)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: Padding(
                  padding: EdgeInsets.only(
                      bottom: MediaQuery.of(context).viewInsets.bottom),
                  child: SafeArea(
                    top: false,
                    child: GestureDetector(
                      // Absorb taps so interacting with the bar doesn't advance.
                      onTap: () {},
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                              children: [
                                for (final e in const [
                                  '❤️', '😂', '😮', '😢', '👏', '🔥'
                                ])
                                  GestureDetector(
                                    onTap: () => _quickReact(e),
                                    child: Padding(
                                      padding:
                                          const EdgeInsets.symmetric(vertical: 4),
                                      child: Text(e,
                                          style: const TextStyle(fontSize: 28)),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _replyCtrl,
                                focusNode: _replyFocus,
                                style: const TextStyle(color: Colors.white),
                                textInputAction: TextInputAction.send,
                                onSubmitted: (_) => _sendReply(),
                                decoration: InputDecoration(
                                  hintText: 'Auf Status antworten …',
                                  hintStyle:
                                      const TextStyle(color: Colors.white70),
                                  filled: true,
                                  fillColor:
                                      Colors.white.withValues(alpha: 0.15),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(24),
                                    borderSide: BorderSide.none,
                                  ),
                                  contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 18, vertical: 10),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            IconButton(
                              icon:
                                  const Icon(Icons.send_rounded, color: Colors.white),
                              onPressed: _sendReply,
                            ),
                          ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _content(AppState state, PingStatus status) {
    // Desktop can't play video (no Windows video_player) — show a placeholder
    // and let the 5s timer carry on to the next status.
    if (_isVideo(status) && !_playableVideo(status)) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.movie_outlined, color: Colors.white54, size: 72),
          const SizedBox(height: 14),
          const Text('Video-Status',
              style: TextStyle(color: Colors.white70, fontSize: 16)),
          if (status.body.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
              child: Text(status.body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 16)),
            ),
        ],
      );
    }
    if (_playableVideo(status) && status.attachment != null) {
      return Column(
        children: [
          Expanded(
            child: _StatusVideoView(
              key: ValueKey(status.id),
              url: state.mediaUrl(status.attachment!.url),
              headers: state.authHeaders,
              onProgress: (p) {
                if (mounted) setState(() => _videoProgress = p);
              },
              onEnd: _next,
            ),
          ),
          if (status.body.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 60),
              child: Text(status.body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 16)),
            ),
        ],
      );
    }
    if (status.isImage && status.attachment != null) {
      return Column(
        children: [
          Expanded(
            child: Center(
              child: Image.network(
                state.mediaUrl(status.attachment!.url),
                headers: state.authHeaders,
                fit: BoxFit.contain,
                loadingBuilder: (ctx, child, p) => p == null
                    ? child
                    : const Center(
                        child: CircularProgressIndicator(color: Colors.white)),
                errorBuilder: (_, _, _) => const Center(
                    child: Icon(Icons.broken_image_rounded,
                        color: Colors.white54, size: 64)),
              ),
            ),
          ),
          if (status.body.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 60),
              child: Text(status.body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 16)),
            ),
        ],
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          status.body,
          textAlign: TextAlign.center,
          style: const TextStyle(
              color: Colors.white, fontSize: 26, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  Widget _bar(int i) {
    return SizedBox(
      height: 3,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: i < _item
            ? Container(color: Colors.white)
            : i > _item
                ? Container(color: Colors.white30)
                : _playableVideo(_current)
                    ? LinearProgressIndicator(
                        value: _videoProgress,
                        backgroundColor: Colors.white30,
                        valueColor:
                            const AlwaysStoppedAnimation<Color>(Colors.white),
                      )
                    : AnimatedBuilder(
                        animation: _progress,
                        builder: (_, _) => LinearProgressIndicator(
                          value: _progress.value,
                          backgroundColor: Colors.white30,
                          valueColor:
                              const AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      ),
      ),
    );
  }

  Widget _header(AppState state, StatusGroup group, PingStatus status) {
    return Row(
      children: [
        PingAvatar(
          initials: group.user.initials,
          color: group.user.color,
          size: 38,
          imageUrl: state.avatarUrl(group.user),
          imageHeaders: state.authHeaders,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              NameWithBadge(
                name: widget.mine ? 'Mein Status' : group.user.label,
                user: widget.mine ? null : group.user,
                glow: group.user.official,
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w700),
              ),
              Text(
                group.user.official && !widget.mine
                    ? 'Offizielles Update · ${TimeFormat.messageTime(DateTime.fromMillisecondsSinceEpoch(status.createdAt))}'
                    : TimeFormat.messageTime(
                        DateTime.fromMillisecondsSinceEpoch(status.createdAt)),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close_rounded, color: Colors.white),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ],
    );
  }
}

/// Plays a video status, reporting progress to the viewer's top bar and calling
/// [onEnd] when it finishes so the story advances.
class _StatusVideoView extends StatefulWidget {
  final String url;
  final Map<String, String>? headers;
  final void Function(double progress) onProgress;
  final VoidCallback onEnd;
  const _StatusVideoView({
    super.key,
    required this.url,
    this.headers,
    required this.onProgress,
    required this.onEnd,
  });

  @override
  State<_StatusVideoView> createState() => _StatusVideoViewState();
}

class _StatusVideoViewState extends State<_StatusVideoView> {
  late final VideoPlayerController _c;
  bool _ready = false;
  bool _ended = false;
  bool _fast = false;

  // Hold to play at 2×, release to return to normal speed.
  void _setFast(bool fast) {
    if (!_ready || _fast == fast) return;
    _c.setPlaybackSpeed(fast ? 2.0 : 1.0);
    setState(() => _fast = fast);
  }

  @override
  void initState() {
    super.initState();
    _c = VideoPlayerController.networkUrl(
      Uri.parse(widget.url),
      httpHeaders: widget.headers ?? const {},
    );
    _c.addListener(_tick);
    _c.initialize().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      _c
        ..setLooping(false)
        ..play();
    }).catchError((_) {
      if (mounted) widget.onEnd();
    });
  }

  void _tick() {
    if (!_ready) return;
    final v = _c.value;
    final dur = v.duration.inMilliseconds;
    if (dur > 0) {
      widget.onProgress((v.position.inMilliseconds / dur).clamp(0.0, 1.0));
      if (!_ended && v.position >= v.duration && !v.isPlaying) {
        _ended = true;
        widget.onEnd();
      }
    }
  }

  @override
  void dispose() {
    _c.removeListener(_tick);
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }
    return GestureDetector(
      // Long-press anywhere on the video to scrub at 2×; tap still bubbles up to
      // the viewer's navigation handler.
      onLongPressStart: (_) => _setFast(true),
      onLongPressEnd: (_) => _setFast(false),
      onLongPressCancel: () => _setFast(false),
      child: Stack(
        alignment: Alignment.topCenter,
        children: [
          Center(
            child: AspectRatio(
              aspectRatio: _c.value.aspectRatio == 0 ? 9 / 16 : _c.value.aspectRatio,
              child: VideoPlayer(_c),
            ),
          ),
          if (_fast)
            const Padding(
              padding: EdgeInsets.only(top: 70),
              child: SpeedBadge(),
            ),
        ],
      ),
    );
  }
}
