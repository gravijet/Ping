import 'package:flutter/material.dart';

/// Lightweight loading placeholders ("skeleton screens"). They mimic the shape
/// of the content that's about to appear so a cold open looks intentional
/// instead of a blank spinner — and they respect the user's *reduce motion*
/// setting by dropping the shimmer sweep for a calm static placeholder.
///
/// Usage: wrap a tree of [SkeletonBox]es in a [Shimmer]. The shimmer sweeps a
/// highlight across whatever is opaque, so only the boxes light up.

/// A single rounded placeholder block in the theme's muted "bone" colour.
class SkeletonBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;
  final EdgeInsetsGeometry? margin;
  final BoxShape shape;

  const SkeletonBox({
    super.key,
    this.width,
    this.height = 14,
    this.radius = 8,
    this.margin,
    this.shape = BoxShape.rectangle,
  });

  /// A circular placeholder (avatar). [size] is the diameter.
  const SkeletonBox.circle(double size, {super.key})
      : width = size,
        height = size,
        radius = 0,
        margin = null,
        shape = BoxShape.circle;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.10);
    return Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        color: base,
        shape: shape,
        borderRadius:
            shape == BoxShape.circle ? null : BorderRadius.circular(radius),
      ),
    );
  }
}

/// Sweeps a soft highlight across its opaque descendants. Set [enabled] to false
/// (e.g. when the user prefers reduced motion) to render a calm static skeleton.
class Shimmer extends StatefulWidget {
  final Widget child;
  final bool enabled;
  const Shimmer({super.key, required this.child, this.enabled = true});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1300),
    );
    if (widget.enabled) _controller.repeat();
  }

  @override
  void didUpdateWidget(covariant Shimmer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.enabled && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.enabled && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    final highlight =
        Theme.of(context).colorScheme.surface.withValues(alpha: 0.55);
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Colors.transparent, highlight, Colors.transparent],
              stops: const [0.0, 0.5, 1.0],
              transform: _SweepTransform(_controller.value),
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// Slides a gradient horizontally from fully off-screen left to off-screen right
/// as [t] runs 0→1, so the highlight band travels cleanly across the content.
class _SweepTransform extends GradientTransform {
  final double t;
  const _SweepTransform(this.t);

  @override
  Matrix4? transform(Rect bounds, {TextDirection? textDirection}) {
    final dx = (t * 2 - 1) * bounds.width;
    return Matrix4.translationValues(dx, 0, 0);
  }
}

/// A full chat-list loading state: several placeholder rows shaped like
/// [ChatTile]. Drop it in wherever the chat list would be while it loads.
class ChatListSkeleton extends StatelessWidget {
  final int rows;
  final bool animate;
  const ChatListSkeleton({super.key, this.rows = 8, this.animate = true});

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      enabled: animate,
      child: ListView.builder(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 6),
        itemCount: rows,
        itemBuilder: (context, i) => const _SkeletonChatRow(),
      ),
    );
  }
}

class _SkeletonChatRow extends StatelessWidget {
  const _SkeletonChatRow();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SkeletonBox.circle(52),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBox(width: 150, height: 13, radius: 6),
                const SizedBox(height: 10),
                SkeletonBox(
                    width: double.infinity, height: 11, radius: 6,
                    margin: const EdgeInsets.only(right: 60)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              SkeletonBox(width: 34, height: 10, radius: 5),
              SizedBox(height: 12),
              SkeletonBox.circle(18),
            ],
          ),
        ],
      ),
    );
  }
}
