import 'dart:io';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../models/settings.dart';
import '../services/wallpaper_service.dart';

/// Paints a chat's background from a [WallpaperSpec]: a theme colour, a preset
/// colour, a still image, an animated GIF or a looping muted video. Media
/// wallpapers get a subtle scrim so message bubbles stay readable.
class ChatWallpaper extends StatelessWidget {
  final WallpaperSpec spec;
  final Color fallback; // theme default wallpaper colour
  const ChatWallpaper({super.key, required this.spec, required this.fallback});

  @override
  Widget build(BuildContext context) {
    switch (spec.kind) {
      case WallpaperKind.defaultBg:
        return Container(color: fallback);
      case WallpaperKind.color:
        return Container(color: _presetColor(context));
      case WallpaperKind.image:
      case WallpaperKind.gif:
        return _MediaImage(
            key: ValueKey('img:${spec.path}'), path: spec.path, fallback: fallback);
      case WallpaperKind.video:
        return _MediaVideo(
            key: ValueKey('vid:${spec.path}'), path: spec.path, fallback: fallback);
    }
  }

  Color _presetColor(BuildContext context) {
    final i = spec.colorIndex;
    if (i <= 0 || i >= kChatWallpapers.length) return fallback;
    final base = Color(kChatWallpapers[i]);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Color.alphaBlend(
        base.withValues(alpha: isDark ? 0.45 : 0.14), fallback);
  }
}

class _MediaImage extends StatelessWidget {
  final String path;
  final Color fallback;
  const _MediaImage({super.key, required this.path, required this.fallback});

  @override
  Widget build(BuildContext context) {
    final file = File(path);
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(color: fallback),
        Image.file(
          file,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => Container(color: fallback),
        ),
        // Keep the conversation legible over busy images.
        const _Scrim(),
      ],
    );
  }
}

class _MediaVideo extends StatefulWidget {
  final String path;
  final Color fallback;
  const _MediaVideo({super.key, required this.path, required this.fallback});

  @override
  State<_MediaVideo> createState() => _MediaVideoState();
}

class _MediaVideoState extends State<_MediaVideo> {
  VideoPlayerController? _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    final c = VideoPlayerController.file(File(widget.path));
    _controller = c;
    c.initialize().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      c
        ..setLooping(true)
        ..setVolume(0)
        ..play();
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(color: widget.fallback),
        if (_ready && c != null)
          FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: c.value.size.width,
              height: c.value.size.height,
              child: VideoPlayer(c),
            ),
          ),
        const _Scrim(),
      ],
    );
  }
}

class _Scrim extends StatelessWidget {
  const _Scrim();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: (isDark ? Colors.black : Colors.white)
            .withValues(alpha: isDark ? 0.28 : 0.12),
      ),
    );
  }
}
