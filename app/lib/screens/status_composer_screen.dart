import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/platform_files.dart';

/// Vibrant background colours for text statuses.
const _statusColors = [
  '#0A84FF', '#5E5CE6', '#34C759', '#FF9F0A',
  '#FF375F', '#BF5AF2', '#FF2D55', '#30B0C7',
  '#1B1F3B', '#263238',
];

/// A handful of common emojis offered as quick-insert in the text composer.
const _statusEmojis = [
  '😀', '😂', '😍', '🥳', '😎', '😭', '👍', '🙏', '🔥', '❤️',
  '🎉', '✨', '😅', '🤔', '😢', '😡', '🥰', '😴', '🙌', '💪',
  '🌟', '☀️', '🍕', '⚽',
];

/// Compose a coloured text status. When [official] is set, it's posted as the
/// "Ping Team" account (admin only) and seen by every user.
class StatusTextComposer extends StatefulWidget {
  final bool official;
  const StatusTextComposer({super.key, this.official = false});

  @override
  State<StatusTextComposer> createState() => _StatusTextComposerState();
}

class _StatusTextComposerState extends State<StatusTextComposer> {
  final _controller = TextEditingController();
  String _color = _statusColors.first;
  bool _busy = false;

  Color get _bg {
    final hex = _color.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _insertEmoji(String e) {
    final sel = _controller.selection;
    final text = _controller.text;
    if (sel.isValid && sel.start >= 0) {
      final next = text.replaceRange(sel.start, sel.end, e);
      _controller.value = TextEditingValue(
        text: next,
        selection: TextSelection.collapsed(offset: sel.start + e.length),
      );
    } else {
      _controller.text = text + e;
      _controller.selection =
          TextSelection.collapsed(offset: _controller.text.length);
    }
    setState(() {});
  }

  Future<void> _post() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _busy = true);
    try {
      final state = context.read<AppState>();
      if (widget.official) {
        await state.postOfficialStatus(type: 'text', body: text, bgColor: _color);
      } else {
        await state.postTextStatus(text, _color);
      }
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(widget.official ? 'Ping-Team-Status' : 'Status'),
        actions: [
          IconButton(
            tooltip: 'Farbe',
            icon: const Icon(Icons.palette_rounded),
            onPressed: () {
              final i = _statusColors.indexOf(_color);
              setState(() =>
                  _color = _statusColors[(i + 1) % _statusColors.length]);
            },
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: TextField(
            controller: _controller,
            autofocus: true,
            maxLines: null,
            textAlign: TextAlign.center,
            cursorColor: Colors.white,
            style: const TextStyle(
                color: Colors.white, fontSize: 26, fontWeight: FontWeight.w600),
            decoration: const InputDecoration(
              border: InputBorder.none,
              hintText: 'Tippe etwas …',
              hintStyle: TextStyle(color: Colors.white70, fontSize: 24),
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Quick emoji strip (the keyboard has the full set — this is just
              // a handy shortcut for the common ones).
              SizedBox(
                height: 38,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final e in _statusEmojis)
                      GestureDetector(
                        onTap: () => _insertEmoji(e),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Text(e, style: const TextStyle(fontSize: 26)),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 40,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          for (final c in _statusColors)
                            GestureDetector(
                              onTap: () => setState(() => _color = c),
                              child: Container(
                                width: 32,
                                height: 32,
                                margin: const EdgeInsets.only(right: 8),
                                decoration: BoxDecoration(
                                  color: Color(int.parse(
                                      'FF${c.replaceFirst('#', '')}',
                                      radix: 16)),
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: _color == c
                                        ? Colors.white
                                        : Colors.white24,
                                    width: _color == c ? 3 : 1,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FloatingActionButton(
                    onPressed: _busy ? null : _post,
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.4, color: Colors.white))
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Preview a picked image and add an optional caption before posting it as a
/// status.
class StatusImageComposer extends StatefulWidget {
  final Uint8List bytes;
  final String contentType;
  final String filename;
  final bool official;

  const StatusImageComposer({
    super.key,
    required this.bytes,
    required this.contentType,
    required this.filename,
    this.official = false,
  });

  @override
  State<StatusImageComposer> createState() => _StatusImageComposerState();
}

class _StatusImageComposerState extends State<StatusImageComposer> {
  final _caption = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    setState(() => _busy = true);
    try {
      final state = context.read<AppState>();
      final att = await state.uploadAttachment(
        widget.bytes,
        widget.contentType,
        filename: widget.filename,
        kind: 'image',
      );
      if (widget.official) {
        await state.postOfficialStatus(
            type: 'image', attachment: att, body: _caption.text.trim());
      } else {
        await state.postImageStatus(att, caption: _caption.text.trim());
      }
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(widget.official ? 'Ping-Team-Status' : 'Status'),
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(child: Image.memory(widget.bytes, fit: BoxFit.contain)),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _caption,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        hintText: 'Beschriftung hinzufügen …',
                        hintStyle: const TextStyle(color: Colors.white54),
                        filled: true,
                        fillColor: Colors.white12,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FloatingActionButton(
                    onPressed: _busy ? null : _post,
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.4, color: Colors.white))
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Preview a picked/recorded video and add an optional caption before posting
/// it as a video status.
class StatusVideoComposer extends StatefulWidget {
  final String path;
  final String contentType;
  final String filename;
  final bool official;

  const StatusVideoComposer({
    super.key,
    required this.path,
    required this.contentType,
    required this.filename,
    this.official = false,
  });

  @override
  State<StatusVideoComposer> createState() => _StatusVideoComposerState();
}

class _StatusVideoComposerState extends State<StatusVideoComposer> {
  final _caption = TextEditingController();
  late final VideoPlayerController _controller;
  bool _ready = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _controller = localFileVideoController(widget.path);
    _controller.initialize().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      _controller
        ..setLooping(true)
        ..play();
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _caption.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    setState(() => _busy = true);
    try {
      final state = context.read<AppState>();
      final bytes = await readLocalBytes(widget.path);
      if (bytes == null) {
        if (mounted) {
          setState(() => _busy = false);
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Das Video konnte nicht gelesen werden.')));
        }
        return;
      }
      if (bytes.length > 30 * 1024 * 1024) {
        if (mounted) {
          setState(() => _busy = false);
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Das Video ist zu groß (max. 30 MB).')));
        }
        return;
      }
      final att = await state.uploadAttachment(
        bytes,
        widget.contentType,
        filename: widget.filename,
        kind: 'video',
      );
      if (widget.official) {
        await state.postOfficialStatus(
            type: 'video', attachment: att, body: _caption.text.trim());
      } else {
        await state.postVideoStatus(att, caption: _caption.text.trim());
      }
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(widget.official ? 'Ping-Team-Status' : 'Status'),
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: _ready
                  ? AspectRatio(
                      aspectRatio: _controller.value.aspectRatio == 0
                          ? 9 / 16
                          : _controller.value.aspectRatio,
                      child: VideoPlayer(_controller),
                    )
                  : const CircularProgressIndicator(color: Colors.white),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _caption,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        hintText: 'Beschriftung hinzufügen …',
                        hintStyle: const TextStyle(color: Colors.white54),
                        filled: true,
                        fillColor: Colors.white12,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FloatingActionButton(
                    onPressed: _busy ? null : _post,
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.4, color: Colors.white))
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
