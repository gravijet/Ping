import 'package:flutter/material.dart';

/// Small "2×" pill shown while a video is held for fast (2×) playback.
class SpeedBadge extends StatelessWidget {
  const SpeedBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(20),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.fast_forward_rounded, color: Colors.white, size: 18),
          SizedBox(width: 6),
          Text('2×',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 14)),
        ],
      ),
    );
  }
}
