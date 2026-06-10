import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../theme.dart';

/// Pick a whole-app design (a seed that drives colours, bubbles, app-bar and
/// chat wallpaper tint) or a custom seed colour.
class DesignScreen extends StatelessWidget {
  const DesignScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final active = state.design;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Design & Farben')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          Text('Wähle ein Farbschema. Es verändert die gesamte App — '
              'Akzente, Sprechblasen, Kopfzeile und den Chat-Hintergrund.',
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.35,
            children: [
              for (final d in kPingDesigns)
                _DesignCard(
                  design: d,
                  selected: active.id == d.id,
                  isDark: isDark,
                  onTap: () => state.setDesign(d),
                ),
            ],
          ),
          const SizedBox(height: 24),
          Text('Eigene Farbe',
              style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          Text('Tippe eine Farbe an — die App baut daraus ein passendes Design.',
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize: 13)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              for (final hex in kAvatarPalette)
                _ColorDot(
                  color: _fromHex(hex),
                  selected: active.id == 'custom' &&
                      active.seed.toARGB32() == _fromHex(hex).toARGB32(),
                  onTap: () => state.setCustomColor(_fromHex(hex)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static Color _fromHex(String hex) =>
      Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));
}

class _DesignCard extends StatelessWidget {
  final PingDesign design;
  final bool selected;
  final bool isDark;
  final VoidCallback onTap;
  const _DesignCard({
    required this.design,
    required this.selected,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = isDark ? const Color(0xFF0B141A) : const Color(0xFFECEFF3);
    final wallpaper =
        Color.alphaBlend(design.seed.withValues(alpha: isDark ? 0.12 : 0.08), base);
    final bubbleOut = Color.alphaBlend(
        design.seed.withValues(alpha: isDark ? 0.55 : 0.20),
        isDark ? base : Colors.white);
    final bubbleIn = isDark ? const Color(0xFF1F2C34) : Colors.white;

    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 3 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Mini chat preview.
            Expanded(
              child: Container(
                color: wallpaper,
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _bubble(bubbleIn, Alignment.centerLeft),
                    const SizedBox(height: 6),
                    _bubble(bubbleOut, Alignment.centerRight),
                  ],
                ),
              ),
            ),
            // Label + brand bar.
            Container(
              color: Color.alphaBlend(
                  Colors.black.withValues(alpha: isDark ? 0.55 : 0.12),
                  design.seed),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      design.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                  ),
                  if (selected)
                    const Icon(Icons.check_circle_rounded,
                        color: Colors.white, size: 18),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bubble(Color color, Alignment align) {
    return Align(
      alignment: align,
      child: Container(
        width: 70,
        height: 14,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(7),
        ),
      ),
    );
  }
}

class _ColorDot extends StatelessWidget {
  final Color color;
  final bool selected;
  final VoidCallback onTap;
  const _ColorDot(
      {required this.color, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(
            color: selected ? scheme.primary : scheme.outline,
            width: selected ? 4 : 1,
          ),
        ),
        child: selected
            ? const Icon(Icons.check_rounded, color: Colors.white, size: 20)
            : null,
      ),
    );
  }
}
