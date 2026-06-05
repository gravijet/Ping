import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// Vibrant background colours for text statuses.
const _statusColors = [
  '#0A84FF', '#5E5CE6', '#34C759', '#FF9F0A',
  '#FF375F', '#BF5AF2', '#FF2D55', '#30B0C7',
  '#1B1F3B', '#263238',
];

/// Compose a coloured text status.
class StatusTextComposer extends StatefulWidget {
  const StatusTextComposer({super.key});

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

  Future<void> _post() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _busy = true);
    try {
      await context.read<AppState>().postTextStatus(text, _color);
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
        title: const Text('Status'),
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
          child: Row(
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

  const StatusImageComposer({
    super.key,
    required this.bytes,
    required this.contentType,
    required this.filename,
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
      await state.postImageStatus(att, caption: _caption.text.trim());
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
        title: const Text('Status'),
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
