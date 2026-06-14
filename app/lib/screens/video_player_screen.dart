import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../widgets/speed_badge.dart';

/// Full-screen player for a network video (auth-gated uploads need [headers]).
class VideoPlayerScreen extends StatefulWidget {
  final String url;
  final Map<String, String>? headers;
  const VideoPlayerScreen({super.key, required this.url, this.headers});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  late final VideoPlayerController _controller;
  bool _ready = false;
  bool _error = false;
  bool _fast = false;

  // Hold to play at 2×, release to return to normal speed.
  void _setFast(bool fast) {
    if (!_ready || _fast == fast) return;
    _controller.setPlaybackSpeed(fast ? 2.0 : 1.0);
    setState(() => _fast = fast);
  }

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(
      Uri.parse(widget.url),
      httpHeaders: widget.headers ?? const {},
    );
    _controller.initialize().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      _controller
        ..setLooping(true)
        ..play();
    }).catchError((_) {
      if (mounted) setState(() => _error = true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _controller.value.isPlaying ? _controller.pause() : _controller.play();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: Center(
        child: _error
            ? const Text('Video konnte nicht geladen werden.',
                style: TextStyle(color: Colors.white70))
            : !_ready
                ? const CircularProgressIndicator(color: Colors.white)
                : GestureDetector(
                    onTap: _toggle,
                    onLongPressStart: (_) => _setFast(true),
                    onLongPressEnd: (_) => _setFast(false),
                    onLongPressCancel: () => _setFast(false),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        AspectRatio(
                          aspectRatio: _controller.value.aspectRatio == 0
                              ? 16 / 9
                              : _controller.value.aspectRatio,
                          child: VideoPlayer(_controller),
                        ),
                        if (!_controller.value.isPlaying)
                          const Icon(Icons.play_circle_fill_rounded,
                              color: Colors.white70, size: 72),
                        if (_fast)
                          const Positioned(top: 24, child: SpeedBadge()),
                        Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: VideoProgressIndicator(
                            _controller,
                            allowScrubbing: true,
                            colors: const VideoProgressColors(
                                playedColor: Colors.white),
                          ),
                        ),
                      ],
                    ),
                  ),
      ),
    );
  }
}
