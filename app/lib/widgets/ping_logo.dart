import 'package:flutter/material.dart';

/// Ping's logo: a rounded chat bubble with three "signal" dots and a little
/// tail, drawn entirely in code so it scales crisply at any size and tints with
/// the brand blue. Used on the splash, login and about surfaces.
class PingLogo extends StatelessWidget {
  final double size;

  /// When true the bubble sits on a filled gradient tile (app-icon style);
  /// otherwise just the glyph is drawn in [glyphColor].
  final bool tile;

  /// Colour of the glyph when [tile] is false (ignored in tile mode).
  final Color glyphColor;

  const PingLogo({
    super.key,
    this.size = 96,
    this.tile = true,
    this.glyphColor = const Color(0xFF0A84FF),
  });

  @override
  Widget build(BuildContext context) {
    if (!tile) {
      return SizedBox.square(
        dimension: size,
        child: CustomPaint(painter: _PingGlyphPainter(glyphColor)),
      );
    }
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0A84FF), Color(0xFF34B7F1)],
        ),
        borderRadius: BorderRadius.circular(size * 0.26),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0A84FF).withValues(alpha: 0.35),
            blurRadius: size * 0.22,
            offset: Offset(0, size * 0.08),
          ),
        ],
      ),
      child: Padding(
        padding: EdgeInsets.all(size * 0.24),
        child: CustomPaint(painter: _PingGlyphPainter(Colors.white)),
      ),
    );
  }
}

class _PingGlyphPainter extends CustomPainter {
  final Color color;
  _PingGlyphPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final paint = Paint()..color = color;

    // Punching transparent holes needs its own layer.
    canvas.saveLayer(Rect.fromLTWH(0, 0, w, h), Paint());

    // Speech bubble body.
    final r = RRect.fromRectAndRadius(
      Rect.fromLTWH(0, 0, w, h * 0.82),
      Radius.circular(w * 0.28),
    );
    final path = Path()..addRRect(r);
    // Tail at the bottom-left.
    path.moveTo(w * 0.20, h * 0.74);
    path.lineTo(w * 0.06, h);
    path.lineTo(w * 0.42, h * 0.78);
    path.close();
    canvas.drawPath(path, paint);

    // Three "ping" dots punched out of the bubble.
    final hole = Paint()..blendMode = BlendMode.clear;
    final cy = h * 0.40;
    final rad = w * 0.072;
    for (final cx in [w * 0.32, w * 0.5, w * 0.68]) {
      canvas.drawCircle(Offset(cx, cy), rad, hole);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _PingGlyphPainter old) => old.color != color;
}
