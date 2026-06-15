import 'package:flutter/services.dart';

import '../models/settings.dart';

/// Small, asset-free haptic + sound cues, gated by the user's settings. Uses the
/// platform's built-in click/haptic channels so it adds nothing to the APK size
/// and can't fail to load a sound file.
class FeedbackService {
  final PingSettings Function() _settings;
  FeedbackService(this._settings);

  PingSettings get _s => _settings();

  /// A light tap + click when the user sends a message.
  void messageSent() {
    if (_s.hapticFeedback) HapticFeedback.lightImpact();
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
    if (_s.hapticFeedback) HapticFeedback.mediumImpact();
  }
}
