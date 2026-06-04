import 'package:flutter/material.dart';

/// A circular gradient avatar showing initials, with an optional online dot.
class PingAvatar extends StatelessWidget {
  final String initials;
  final Color color;
  final double size;
  final bool? online; // null = don't show a presence dot
  final IconData? icon;

  const PingAvatar({
    super.key,
    required this.initials,
    required this.color,
    this.size = 48,
    this.online,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color.lerp(color, Colors.white, 0.18)!,
                  Color.lerp(color, Colors.black, 0.12)!,
                ],
              ),
            ),
            alignment: Alignment.center,
            child: icon != null
                ? Icon(icon, color: Colors.white, size: size * 0.5)
                : Text(
                    initials,
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: size * 0.36,
                    ),
                  ),
          ),
          if (online != null && online!)
            Positioned(
              right: -1,
              bottom: -1,
              child: Container(
                width: size * 0.28,
                height: size * 0.28,
                decoration: BoxDecoration(
                  color: const Color(0xFF22C55E),
                  shape: BoxShape.circle,
                  border: Border.all(color: scheme.surface, width: 2.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
