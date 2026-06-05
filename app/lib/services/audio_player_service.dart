import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// A single shared audio player for voice notes / audio attachments. The bubble
/// resolves the attachment to a local file first (see [MediaService]) and hands
/// the path here; only one clip plays at a time.
class AudioController extends ChangeNotifier {
  final AudioPlayer _player = AudioPlayer();
  bool _wired = false;

  String? currentUrl;
  bool playing = false;
  Duration position = Duration.zero;
  Duration duration = Duration.zero;

  void _wire() {
    if (_wired) return;
    _wired = true;
    _player.onPositionChanged.listen((p) {
      position = p;
      notifyListeners();
    });
    _player.onDurationChanged.listen((d) {
      duration = d;
      notifyListeners();
    });
    _player.onPlayerComplete.listen((_) {
      playing = false;
      position = Duration.zero;
      notifyListeners();
    });
    _player.onPlayerStateChanged.listen((s) {
      playing = s == PlayerState.playing;
      notifyListeners();
    });
  }

  bool isCurrent(String url) => currentUrl == url;

  /// Play [path] (a local file) for attachment [url]. Tapping the same clip
  /// toggles play/pause.
  Future<void> toggleFile(String url, String path) async {
    _wire();
    if (currentUrl == url) {
      if (playing) {
        await _player.pause();
      } else {
        await _player.resume();
      }
      return;
    }
    currentUrl = url;
    position = Duration.zero;
    duration = Duration.zero;
    notifyListeners();
    try {
      await _player.stop();
      await _player.play(DeviceFileSource(path));
    } catch (_) {
      currentUrl = null;
      playing = false;
      notifyListeners();
    }
  }

  Future<void> seek(Duration to) async {
    try {
      await _player.seek(to);
    } catch (_) {}
  }

  Future<void> stop() async {
    try {
      await _player.stop();
    } catch (_) {}
    playing = false;
    currentUrl = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }
}
