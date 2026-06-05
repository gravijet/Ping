import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/status.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';

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

  @override
  void initState() {
    super.initState();
    _group = widget.initialGroup.clamp(0, widget.groups.length - 1);
    _progress = AnimationController(vsync: this, duration: const Duration(seconds: 5))
      ..addStatusListener((s) {
        if (s == AnimationStatus.completed) _next();
      });
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  StatusGroup get _currentGroup => widget.groups[_group];
  PingStatus get _current => _currentGroup.items[_item];

  void _start() {
    if (!widget.mine) {
      context.read<AppState>().markStatusViewed(_current.id);
    }
    _progress
      ..reset()
      ..forward();
  }

  void _next() {
    if (_item < _currentGroup.items.length - 1) {
      setState(() => _item++);
      _start();
    } else if (_group < widget.groups.length - 1) {
      setState(() {
        _group++;
        _item = 0;
      });
      _start();
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _prev() {
    if (_item > 0) {
      setState(() => _item--);
      _start();
    } else if (_group > 0) {
      setState(() {
        _group--;
        _item = 0;
      });
      _start();
    } else {
      _progress
        ..reset()
        ..forward();
    }
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
                        title: Text(v.user.label),
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
    if (mounted) _progress.forward();
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
      if (mounted) _progress.forward();
      return;
    }
    await state.deleteStatus(_current.id);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final status = _current;
    final group = _currentGroup;

    return Scaffold(
      backgroundColor: status.isImage ? Colors.black : status.background,
      body: GestureDetector(
        onTapUp: (d) {
          final w = MediaQuery.of(context).size.width;
          if (d.globalPosition.dx < w * 0.33) {
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
          ],
        ),
      ),
    );
  }

  Widget _content(AppState state, PingStatus status) {
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
              Text(
                widget.mine ? 'Mein Status' : group.user.label,
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w700),
              ),
              Text(
                TimeFormat.messageTime(
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
