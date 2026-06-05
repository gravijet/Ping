import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// Thin wrapper around flutter_tts: reads messages aloud and exposes which
/// message is currently speaking so the bubble can show a stop button.
class TtsController extends ChangeNotifier {
  final FlutterTts _tts = FlutterTts();
  bool _ready = false;

  String? speakingId; // id of the message being spoken, if any
  String language = 'de-DE';
  double rate = 0.5; // 0..1 (flutter_tts scale)
  double pitch = 1.0; // 0.5..2

  Future<void> _ensure() async {
    if (_ready) return;
    _ready = true;
    try {
      await _tts.awaitSpeakCompletion(true);
      _tts.setCompletionHandler(() {
        speakingId = null;
        notifyListeners();
      });
      _tts.setCancelHandler(() {
        speakingId = null;
        notifyListeners();
      });
    } catch (_) {
      /* platform without TTS — calls below just no-op */
    }
  }

  Future<void> configure({String? language, double? rate, double? pitch}) async {
    if (language != null) this.language = language;
    if (rate != null) this.rate = rate;
    if (pitch != null) this.pitch = pitch;
    notifyListeners();
  }

  /// Speak [text]. If the same [id] is already speaking, stop instead (toggle).
  Future<void> speak(String id, String text) async {
    await _ensure();
    if (speakingId == id) {
      await stop();
      return;
    }
    final clean = text.trim();
    if (clean.isEmpty) return;
    try {
      await _tts.stop();
      await _tts.setLanguage(language);
      await _tts.setSpeechRate(rate);
      await _tts.setPitch(pitch);
      speakingId = id;
      notifyListeners();
      await _tts.speak(clean);
    } catch (_) {
      speakingId = null;
      notifyListeners();
    }
  }

  Future<void> stop() async {
    try {
      await _tts.stop();
    } catch (_) {}
    speakingId = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _tts.stop();
    super.dispose();
  }
}
