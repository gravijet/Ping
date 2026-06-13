import 'package:flutter/material.dart';

/// Ping's logo: a rounded chat bubble with a "ping" sonar signal (a dot sending
/// out two radiating waves) and a little tail, drawn entirely in code so it
/// scales crisply at any size and tints with the brand blue. Used on the splash,
/// login and about surfaces.
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
          colors: [Color(0xFF0B6BFF), Color(0xFF1E9BFF), Color(0xFF38D0FF)],
          stops: [0.0, 0.55, 1.0],
        ),
        borderRadius: BorderRadius.circular(size * 0.27),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0A84FF).withValues(alpha: 0.45),
            blurRadius: size * 0.26,
            offset: Offset(0, size * 0.10),
          ),
        ],
      ),
      child: Stack(
        children: [
          // A soft top-left sheen gives the tile a glassy, premium finish.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(size * 0.27),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.center,
                  colors: [
                    Colors.white.withValues(alpha: 0.28),
                    Colors.white.withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.all(size * 0.24),
            child: CustomPaint(painter: _PingGlyphPainter(Colors.white)),
          ),
        ],
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
    final paint = Paint()
      ..color = color
      ..isAntiAlias = true;

    // Punching transparent holes (the sonar signal) needs its own layer.
    canvas.saveLayer(Rect.fromLTWH(0, 0, w, h), Paint());

    // Speech-bubble body with a soft tail at the bottom-left.
    final r = RRect.fromRectAndRadius(
      Rect.fromLTWH(0, 0, w, h * 0.82),
      Radius.circular(w * 0.30),
    );
    final path = Path()..addRRect(r);
    path.moveTo(w * 0.20, h * 0.72);
    path.lineTo(w * 0.05, h * 1.00);
    path.lineTo(w * 0.44, h * 0.78);
    path.close();
    canvas.drawPath(path, paint);

    // The "ping": a dot at the lower-left sending two sonar waves up-right.
    final clear = Paint()
      ..blendMode = BlendMode.clear
      ..isAntiAlias = true;
    final origin = Offset(w * 0.36, h * 0.52);

    canvas.drawCircle(origin, w * 0.072, clear);

    final wave = Paint()
      ..blendMode = BlendMode.clear
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = w * 0.062
      ..isAntiAlias = true;
    // Arcs open toward the upper-right (≈ -80° → +6°).
    const start = -1.40;
    const sweep = 1.50;
    canvas.drawArc(
        Rect.fromCircle(center: origin, radius: w * 0.20), start, sweep, false, wave);
    canvas.drawArc(
        Rect.fromCircle(center: origin, radius: w * 0.30), start, sweep, false, wave);

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _PingGlyphPainter old) => old.color != color;
}
