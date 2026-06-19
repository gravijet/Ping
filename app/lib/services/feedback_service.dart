import 'package:flutter/services.dart';

import '../models/settings.dart';
import 'device_info_service.dart';

/// Small, asset-free haptic + sound cues, gated by the user's settings. Uses the
/// platform's built-in click/haptic channels so it adds nothing to the APK size
/// and can't fail to load a sound file.
///
/// When the native Android bridge is available, distinct interactions get
/// crisper, purpose-built vibration patterns (a soft tick on send, a sharper
/// double-buzz on error) via the system Vibrator; everywhere else it
/// transparently falls back to Flutter's built-in [HapticFeedback].
class FeedbackService {
  final PingSettings Function() _settings;
  final DeviceInfoService? _device;
  FeedbackService(this._settings, [this._device]);

  PingSettings get _s => _settings();

  /// Prefer a native vibration pattern; fall back to the given Flutter haptic.
  void _haptic(String pattern, void Function() fallback) {
    final device = _device;
    if (device != null && device.supported) {
      device.vibrate(pattern);
    } else {
      fallback();
    }
  }

  /// A light tap + click when the user sends a message.
  void messageSent() {
    if (_s.hapticFeedback) _haptic('tick', HapticFeedback.lightImpact);
    if (_s.inAppSounds) SystemSound.play(SystemSoundType.click);
  }

  /// A soft cue when a message arrives in the chat that's currently open.
  void messageReceived() {
    if (_s.inAppSounds) SystemSound.play(SystemSoundType.click);
  }

  /// Subtle selection feedback for taps on list actions / toggles.
  void tap() {
    if (_s.hapticFeedback) HapticFeedback.selectionClick();
  }

  /// A firmer bump for swipe actions and long-press menus.
  void impact() {
    if (_s.hapticFeedback) _haptic('click', HapticFeedback.mediumImpact);
  }

  /// A distinct double-buzz for errors (failed send, denied action).
  void error() {
    if (_s.hapticFeedback) _haptic('error', HapticFeedback.heavyImpact);
  }

  /// A short success flourish (e.g. a completed action).
  void success() {
    if (_s.hapticFeedback) _haptic('success', HapticFeedback.lightImpact);
  }
}
