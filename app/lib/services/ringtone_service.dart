import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Plays the call ring tones and drives the ringing vibration, so a Ping call
/// sounds and feels like a real phone call:
///
///  * **outgoing** → a calm European-style *ringback* (one 425 Hz tone every few
///    seconds) while we wait for the other side to pick up;
///  * **incoming** → an attention-grabbing dual-tone *ringtone* plus a repeating
///    vibration pulse.
///
/// The tones are synthesised in memory (no bundled assets) and looped, and they
/// are routed to the phone's ring/notification audio stream so they respect the
/// ringer/silent switch the way a real call does.
class RingtoneService {
  final AudioPlayer _player = AudioPlayer();
  Timer? _vibrate;
  bool _active = false;
  bool _configured = false;

  bool get _supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> _configure() async {
    if (_configured || !_supported) return;
    _configured = true;
    try {
      await _player.setReleaseMode(ReleaseMode.loop);
      await _player.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            isSpeakerphoneOn: true,
            stayAwake: true,
            contentType: AndroidContentType.sonification,
            usageType: AndroidUsageType.notificationRingtone,
            audioFocus: AndroidAudioFocus.gainTransientMayDuck,
          ),
        ),
      );
    } catch (_) {
      /* fall back to defaults */
    }
  }

  /// Start the *ringback* the caller hears while the call is dialling.
  Future<void> startOutgoing() => _start(incoming: false);

  /// Start the *ringtone* + vibration the callee hears for an incoming call.
  Future<void> startIncoming() => _start(incoming: true);

  Future<void> _start({required bool incoming}) async {
    if (!_supported) return;
    await stop();
    await _configure();
    _active = true;
    try {
      final wav = incoming ? _incomingRingtone() : _ringback();
      await _player.setReleaseMode(ReleaseMode.loop);
      await _player.setVolume(1.0);
      await _player.play(BytesSource(wav, mimeType: 'audio/wav'));
    } catch (_) {
      /* audio is best-effort; vibration still conveys the call */
    }
    if (incoming) {
      _pulse();
      _vibrate = Timer.periodic(const Duration(milliseconds: 1500), (_) {
        if (_active) _pulse();
      });
    }
  }

  void _pulse() {
    // A double buzz reads clearly as "ringing" rather than a single tap.
    HapticFeedback.heavyImpact();
    Future.delayed(const Duration(milliseconds: 220), () {
      if (_active) HapticFeedback.heavyImpact();
    });
  }

  /// Stop any tone + vibration immediately.
  Future<void> stop() async {
    _active = false;
    _vibrate?.cancel();
    _vibrate = null;
    if (!_supported) return;
    try {
      await _player.stop();
    } catch (_) {
      /* already stopped */
    }
  }

  Future<void> dispose() async {
    _vibrate?.cancel();
    try {
      await _player.dispose();
    } catch (_) {
      /* ignore */
    }
  }

  // ---- Tone synthesis ------------------------------------------------------

  static const int _rate = 16000;

  /// European ringback: a single 425 Hz tone, 1 s on / 3 s off, looped.
  Uint8List _ringback() {
    final samples = Float64List(_rate * 4); // 4-second cycle
    _writeTone(samples, freqs: const [425], start: 0.0, dur: 1.0, gain: 0.7);
    return _wav(samples);
  }

  /// Incoming ringtone: a classic dual-tone "ring … ring" (440 + 480 Hz), two
  /// short bursts then a pause, looped — instantly recognisable as a call.
  Uint8List _incomingRingtone() {
    final samples = Float64List((_rate * 3.2).round()); // 3.2-second cycle
    _writeTone(samples, freqs: const [440, 480], start: 0.0, dur: 0.4, gain: 0.8);
    _writeTone(samples, freqs: const [440, 480], start: 0.6, dur: 0.4, gain: 0.8);
    return _wav(samples);
  }

  /// Mix one (possibly multi-frequency) tone into [samples] over [dur] seconds
  /// starting at [start], with a short attack/decay envelope to avoid clicks.
  void _writeTone(
    Float64List samples, {
    required List<int> freqs,
    required double start,
    required double dur,
    required double gain,
  }) {
    final from = (start * _rate).round();
    final count = (dur * _rate).round();
    final fade = (_rate * 0.01).round(); // 10 ms attack/release
    for (var i = 0; i < count; i++) {
      final idx = from + i;
      if (idx < 0 || idx >= samples.length) continue;
      final t = i / _rate;
      var v = 0.0;
      for (final f in freqs) {
        v += math.sin(2 * math.pi * f * t);
      }
      v /= freqs.length;
      var env = 1.0;
      if (i < fade) {
        env = i / fade;
      } else if (i > count - fade) {
        env = (count - i) / fade;
      }
      samples[idx] += v * gain * env;
    }
  }

  /// Wrap 16-bit PCM mono samples (range ~[-1,1]) into a WAV byte buffer.
  Uint8List _wav(Float64List samples) {
    final n = samples.length;
    final bytes = BytesBuilder();
    final header = ByteData(44);
    final dataLen = n * 2;
    void tag(int off, String s) {
      for (var i = 0; i < s.length; i++) {
        header.setUint8(off + i, s.codeUnitAt(i));
      }
    }

    tag(0, 'RIFF');
    header.setUint32(4, 36 + dataLen, Endian.little);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    header.setUint32(16, 16, Endian.little); // PCM chunk size
    header.setUint16(20, 1, Endian.little); // PCM format
    header.setUint16(22, 1, Endian.little); // mono
    header.setUint32(24, _rate, Endian.little);
    header.setUint32(28, _rate * 2, Endian.little); // byte rate
    header.setUint16(32, 2, Endian.little); // block align
    header.setUint16(34, 16, Endian.little); // bits per sample
    tag(36, 'data');
    header.setUint32(40, dataLen, Endian.little);
    bytes.add(header.buffer.asUint8List());

    final pcm = ByteData(dataLen);
    for (var i = 0; i < n; i++) {
      final clamped = samples[i].clamp(-1.0, 1.0);
      pcm.setInt16(i * 2, (clamped * 32767).round(), Endian.little);
    }
    bytes.add(pcm.buffer.asUint8List());
    return bytes.toBytes();
  }
}
