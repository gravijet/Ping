import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/settings.dart';
import '../services/app_state.dart';
import '../services/platform_files.dart';
import '../services/wallpaper_service.dart';

/// A reusable wallpaper chooser: the preset colours plus "pick image / GIF /
/// video" actions. Used for the global default (Settings → Chats) and for the
/// per-chat override (chat info). [onPick] receives the chosen spec; passing
/// the sentinel default re-uses the theme (global) or the global wallpaper
/// (per-chat), depending on [defaultLabel].
class WallpaperPicker extends StatefulWidget {
  final WallpaperSpec current;
  final void Function(WallpaperSpec spec) onPick;
  final String defaultLabel;

  const WallpaperPicker({
    super.key,
    required this.current,
    required this.onPick,
    this.defaultLabel = 'Standard',
  });

  @override
  State<WallpaperPicker> createState() => _WallpaperPickerState();
}

class _WallpaperPickerState extends State<WallpaperPicker> {
  bool _busy = false;

  bool _isSelected(WallpaperSpec s) {
    final c = widget.current;
    if (s.kind != c.kind) return false;
    if (s.kind == WallpaperKind.color) return s.colorIndex == c.colorIndex;
    return true;
  }

  Future<void> _pick(Future<WallpaperSpec?> Function() picker) async {
    setState(() => _busy = true);
    try {
      final spec = await picker();
      if (spec != null) widget.onPick(spec);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final service = context.read<AppState>().wallpapers;
    final current = widget.current;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              // Default (theme / inherit-global).
              _swatch(
                selected: current.kind == WallpaperKind.defaultBg,
                color: scheme.surfaceContainerHighest,
                icon: Icons.block_rounded,
                onTap: () => widget.onPick(WallpaperSpec.defaultBg),
              ),
              for (var i = 1; i < kChatWallpapers.length; i++)
                _swatch(
                  selected: _isSelected(WallpaperSpec.color(i)),
                  color: Color(kChatWallpapers[i]),
                  onTap: () => widget.onPick(WallpaperSpec.color(i)),
                ),
              // Current media selection preview.
              if (current.isMedia)
                _MediaThumb(spec: current),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _action(
                icon: Icons.image_rounded,
                label: 'Bild',
                onTap: _busy ? null : () => _pick(service.pickImage),
              ),
              _action(
                icon: Icons.gif_box_rounded,
                label: 'GIF',
                onTap: _busy ? null : () => _pick(service.pickGif),
              ),
              _action(
                icon: Icons.movie_rounded,
                label: 'Video',
                onTap: _busy ? null : () => _pick(service.pickVideo),
              ),
            ],
          ),
        ),
        if (_busy)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          ),
      ],
    );
  }

  Widget _swatch({
    required bool selected,
    required Color color,
    required VoidCallback onTap,
    IconData? icon,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? scheme.primary : Colors.transparent,
            width: 3,
          ),
        ),
        child: icon != null ? Icon(icon, size: 18) : null,
      ),
    );
  }

  Widget _action({
    required IconData icon,
    required String label,
    required VoidCallback? onTap,
  }) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }
}

class _MediaThumb extends StatelessWidget {
  final WallpaperSpec spec;
  const _MediaThumb({required this.spec});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget inner;
    if (spec.kind == WallpaperKind.video) {
      inner = Container(
        color: scheme.surfaceContainerHighest,
        child: const Icon(Icons.movie_rounded, size: 22),
      );
    } else {
      inner = localFileImage(
        spec.path,
        fit: BoxFit.cover,
        errorChild: () => Container(
          color: scheme.surfaceContainerHighest,
          child: const Icon(Icons.broken_image_rounded, size: 20),
        ),
      );
    }
    return Container(
      width: 56,
      height: 56,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.primary, width: 3),
      ),
      child: inner,
    );
  }
}
