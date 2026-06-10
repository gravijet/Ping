import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

/// A finger-painting canvas for drawing your own sticker. Returns the drawing
/// as a transparent PNG (Uint8List) via Navigator.pop, or null if cancelled.
class StickerDrawScreen extends StatefulWidget {
  const StickerDrawScreen({super.key});

  @override
  State<StickerDrawScreen> createState() => _StickerDrawScreenState();
}

class _Stroke {
  final List<Offset> points;
  final Color color;
  final double width;
  _Stroke(this.points, this.color, this.width);
}

class _StickerDrawScreenState extends State<StickerDrawScreen> {
  final _boundaryKey = GlobalKey();
  final List<_Stroke> _strokes = [];
  _Stroke? _active;
  bool _exporting = false;

  Color _color = const Color(0xFF0A84FF);
  double _width = 8;

  static const _palette = [
    Color(0xFF0A84FF), Color(0xFF34C759), Color(0xFFFF9F0A),
    Color(0xFFFF375F), Color(0xFFBF5AF2), Color(0xFF000000),
    Color(0xFFFFFFFF), Color(0xFF5E5CE6), Color(0xFFFF2D55),
  ];

  void _start(Offset p) {
    _active = _Stroke([p], _color, _width);
    setState(() => _strokes.add(_active!));
  }

  void _extend(Offset p) {
    if (_active == null) return;
    setState(() => _active!.points.add(p));
  }

  void _undo() {
    if (_strokes.isEmpty) return;
    setState(() => _strokes.removeLast());
  }

  void _clear() => setState(() => _strokes.clear());

  Future<void> _done() async {
    if (_strokes.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _exporting = true);
    try {
      final boundary = _boundaryKey.currentContext?.findRenderObject()
          as RenderRepaintBoundary?;
      if (boundary == null) {
        if (mounted) Navigator.of(context).pop();
        return;
      }
      final image = await boundary.toImage(pixelRatio: 3.0);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (!mounted) return;
      Navigator.of(context).pop(data?.buffer.asUint8List());
    } catch (_) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sticker zeichnen'),
        actions: [
          IconButton(
            tooltip: 'Rückgängig',
            icon: const Icon(Icons.undo_rounded),
            onPressed: _strokes.isEmpty ? null : _undo,
          ),
          IconButton(
            tooltip: 'Alles löschen',
            icon: const Icon(Icons.delete_outline_rounded),
            onPressed: _strokes.isEmpty ? null : _clear,
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: Container(
                  // A subtle checkerboard-ish surface to signal transparency;
                  // the exported PNG itself keeps a transparent background.
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
                  child: RepaintBoundary(
                    key: _boundaryKey,
                    child: GestureDetector(
                      onPanStart: (d) => _start(d.localPosition),
                      onPanUpdate: (d) => _extend(d.localPosition),
                      child: CustomPaint(
                        painter: _CanvasPainter(_strokes),
                        size: Size.infinite,
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          _toolbar(scheme),
        ],
      ),
    );
  }

  Widget _toolbar(ColorScheme scheme) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final c in _palette)
                    GestureDetector(
                      onTap: () => setState(() => _color = c),
                      child: Container(
                        width: 34,
                        height: 34,
                        margin: const EdgeInsets.symmetric(
                            horizontal: 5, vertical: 5),
                        decoration: BoxDecoration(
                          color: c,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: _color == c ? scheme.primary : scheme.outline,
                            width: _color == c ? 3 : 1,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Row(
              children: [
                const Icon(Icons.line_weight_rounded, size: 20),
                Expanded(
                  child: Slider(
                    value: _width,
                    min: 2,
                    max: 28,
                    onChanged: (v) => setState(() => _width = v),
                  ),
                ),
                FilledButton.icon(
                  onPressed: _exporting ? null : _done,
                  icon: _exporting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.2, color: Colors.white))
                      : const Icon(Icons.send_rounded),
                  label: const Text('Senden'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CanvasPainter extends CustomPainter {
  final List<_Stroke> strokes;
  _CanvasPainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    for (final stroke in strokes) {
      final paint = Paint()
        ..color = stroke.color
        ..strokeWidth = stroke.width
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke;
      if (stroke.points.length == 1) {
        canvas.drawPoints(ui.PointMode.points, stroke.points,
            paint..strokeCap = StrokeCap.round);
        continue;
      }
      final path = Path()
        ..moveTo(stroke.points.first.dx, stroke.points.first.dy);
      for (var i = 1; i < stroke.points.length; i++) {
        path.lineTo(stroke.points[i].dx, stroke.points[i].dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _CanvasPainter oldDelegate) => true;
}
