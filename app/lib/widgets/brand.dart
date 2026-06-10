import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

/// The signature Ping brand gradient, derived from the current design's brand +
/// accent colours so it changes with the selected theme. Used for app bars,
/// headers and the primary action button.
LinearGradient pingBrandGradient(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
  final brand = context.ping.brand;
  return LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      brand,
      Color.lerp(brand, scheme.secondary, 0.65) ?? brand,
    ],
  );
}

/// A gradient app bar that gives every screen Ping's branded header instead of a
/// flat fill. Drop-in replacement for [AppBar] in a [Scaffold].
AppBar pingAppBar(
  BuildContext context, {
  Widget? title,
  List<Widget>? actions,
  Widget? leading,
  PreferredSizeWidget? bottom,
  double? titleSpacing,
  bool centerTitle = false,
}) {
  return AppBar(
    title: title,
    actions: actions,
    leading: leading,
    bottom: bottom,
    titleSpacing: titleSpacing,
    centerTitle: centerTitle,
    backgroundColor: Colors.transparent,
    elevation: 0,
    scrolledUnderElevation: 0,
    systemOverlayStyle: SystemUiOverlayStyle.light,
    flexibleSpace: Container(
      decoration: BoxDecoration(gradient: pingBrandGradient(context)),
    ),
  );
}

/// A gradient pill action button — the modern, non-"0815" replacement for the
/// default [FloatingActionButton.extended]. Soft shadow + brand gradient.
class PingGradientFab extends StatelessWidget {
  final VoidCallback onPressed;
  final IconData icon;
  final String? label;
  final String? heroTag;

  const PingGradientFab({
    super.key,
    required this.onPressed,
    required this.icon,
    this.label,
    this.heroTag,
  });

  @override
  Widget build(BuildContext context) {
    final gradient = pingBrandGradient(context);
    final radius = BorderRadius.circular(20);
    final child = Container(
      height: 56,
      padding: EdgeInsets.symmetric(horizontal: label == null ? 18 : 22),
      decoration: BoxDecoration(
        gradient: gradient,
        borderRadius: radius,
        boxShadow: [
          BoxShadow(
            color: context.ping.brand.withValues(alpha: 0.45),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white),
          if (label != null) ...[
            const SizedBox(width: 10),
            Text(
              label!,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 15,
              ),
            ),
          ],
        ],
      ),
    );

    final button = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: radius,
        child: child,
      ),
    );

    return heroTag != null
        ? Hero(tag: heroTag!, child: button)
        : button;
  }
}
