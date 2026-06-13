import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/user.dart';

/// The kind of trust badge to show next to a name.
enum BadgeKind {
  /// The system "Ping Team" account — a brand-gradient scalloped seal. The most
  /// prominent of the three, so official messages are unmistakable.
  official,

  /// Ping staff / admins — a clean blue verification check.
  verified,

  /// Ping Premium members — a gold rosette.
  premium,
}

/// Resolve the single, highest-priority badge for a user (official > verified >
/// premium), or null when the account carries none.
BadgeKind? badgeKindFor(PingUser? user) {
  if (user == null) return null;
  if (user.official) return BadgeKind.official;
  if (user.verified) return BadgeKind.verified;
  if (user.premium) return BadgeKind.premium;
  return null;
}

/// A small trust badge (official seal / verified check / premium rosette) drawn
/// to scale so it stays crisp inline next to a name at any size.
class PingBadge extends StatelessWidget {
  final BadgeKind kind;
  final double size;

  /// A soft glow behind the badge — used on hero surfaces (chat header, status
  /// viewer) to make official content pop. Off in dense lists.
  final bool glow;

  const PingBadge({super.key, required this.kind, this.size = 16, this.glow = false});

  /// Build the badge for [user], or an empty box when there's nothing to show.
  static Widget forUser(PingUser? user, {double size = 16, bool glow = false}) {
    final kind = badgeKindFor(user);
    if (kind == null) return const SizedBox.shrink();
    return PingBadge(kind: kind, size: size, glow: glow);
  }

  @override
  Widget build(BuildContext context) {
    switch (kind) {
      case BadgeKind.official:
        return _seal(
          const [Color(0xFF0A84FF), Color(0xFF34B7F1)],
          glowColor: const Color(0xFF0A84FF),
        );
      case BadgeKind.verified:
        return _seal(
          const [Color(0xFF1FA2FF), Color(0xFF1D9BF0)],
          glowColor: const Color(0xFF1D9BF0),
        );
      case BadgeKind.premium:
        return _seal(
          const [Color(0xFFFFD25F), Color(0xFFF5A623)],
          glowColor: const Color(0xFFF5A623),
          rosette: true,
        );
    }
  }

  Widget _seal(List<Color> colors, {required Color glowColor, bool rosette = false}) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _SealPainter(
          colors: colors,
          rosette: rosette,
          glow: glow ? glowColor : null,
        ),
      ),
    );
  }
}

class _SealPainter extends CustomPainter {
  final List<Color> colors;
  final bool rosette; // more, pointier bumps for the premium look
  final Color? glow;

  _SealPainter({required this.colors, required this.rosette, this.glow});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final c = Offset(w / 2, w / 2);

    if (glow != null) {
      canvas.drawCircle(
        c,
        w * 0.5,
        Paint()
          ..color = glow!.withValues(alpha: 0.45)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
      );
    }

    final seal = _sealPath(w, c, rosette);
    final fill = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: colors,
      ).createShader(Rect.fromCircle(center: c, radius: w * 0.5));
    canvas.drawPath(seal, fill);

    // Crisp white glyph on top: a check for trust badges, a star for premium.
    final glyph = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.11
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    if (rosette) {
      _drawStar(canvas, c, w * 0.20, w * 0.085,
          Paint()..color = Colors.white);
    } else {
      final check = Path()
        ..moveTo(w * 0.34, w * 0.52)
        ..lineTo(w * 0.45, w * 0.63)
        ..lineTo(w * 0.67, w * 0.39);
      canvas.drawPath(check, glyph);
    }
  }

  /// A scalloped seal: a centre disc fringed with [bumps] half-circles, unioned
  /// into one shape — the classic "verified" silhouette.
  Path _sealPath(double w, Offset c, bool rosette) {
    final bumps = rosette ? 12 : 9;
    final ring = w * (rosette ? 0.30 : 0.31);
    final bump = w * (rosette ? 0.135 : 0.16);
    Path p = Path()..addOval(Rect.fromCircle(center: c, radius: w * 0.34));
    for (var i = 0; i < bumps; i++) {
      final a = (i / bumps) * 2 * math.pi;
      final bc = c + Offset(math.cos(a) * ring, math.sin(a) * ring);
      p = Path.combine(
        PathOperation.union,
        p,
        Path()..addOval(Rect.fromCircle(center: bc, radius: bump)),
      );
    }
    return p;
  }

  void _drawStar(Canvas canvas, Offset c, double outer, double inner, Paint paint) {
    final path = Path();
    for (var i = 0; i < 10; i++) {
      final r = i.isEven ? outer : inner;
      final a = (i / 10) * 2 * math.pi - math.pi / 2;
      final p = c + Offset(math.cos(a) * r, math.sin(a) * r);
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _SealPainter old) =>
      old.colors != colors || old.rosette != rosette || old.glow != glow;
}

/// A name + its trust badge laid out inline, with the name ellipsised and the
/// badge pinned beside it. The single most-used way to show who someone is.
class NameWithBadge extends StatelessWidget {
  final String name;
  final PingUser? user;
  final TextStyle? style;
  final double badgeSize;
  final bool glow;
  final TextAlign? textAlign;

  const NameWithBadge({
    super.key,
    required this.name,
    required this.user,
    this.style,
    this.badgeSize = 16,
    this.glow = false,
    this.textAlign,
  });

  @override
  Widget build(BuildContext context) {
    final kind = badgeKindFor(user);
    if (kind == null) {
      return Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: style,
        textAlign: textAlign,
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: style,
            textAlign: textAlign,
          ),
        ),
        SizedBox(width: badgeSize * 0.28),
        PingBadge(kind: kind, size: badgeSize, glow: glow),
      ],
    );
  }
}
