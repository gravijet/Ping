import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Hashing for the local app-lock PIN.
///
/// This is a convenience gate that keeps prying eyes out of an unlocked phone —
/// not end-to-end security. A salted SHA-256 keeps the PIN out of plaintext
/// storage; the salt is a fixed app constant because the hash never leaves the
/// device and only ever guards the local UI.
class AppLock {
  AppLock._();

  static const _salt = 'ping-app-lock-v1';

  /// Lowest/highest number of digits we accept for a PIN.
  static const minPinLength = 4;
  static const maxPinLength = 8;

  /// Salted SHA-256 of [pin], as a lowercase hex string.
  static String hashPin(String pin) =>
      sha256.convert(utf8.encode('$_salt:$pin')).toString();

  /// Whether [pin] matches the stored [hash]. Always false for an empty PIN or
  /// when no hash has been set yet.
  static bool verify(String pin, String hash) =>
      pin.isNotEmpty && hash.isNotEmpty && hashPin(pin) == hash;

  /// Validate a candidate PIN before it's accepted (digits only, sane length).
  static bool isValidPin(String pin) =>
      pin.length >= minPinLength &&
      pin.length <= maxPinLength &&
      RegExp(r'^\d+$').hasMatch(pin);

  /// Selectable auto-lock grace periods (seconds → human label).
  static const graceOptions = <int, String>{
    0: 'Sofort',
    30: 'Nach 30 Sekunden',
    60: 'Nach 1 Minute',
    300: 'Nach 5 Minuten',
    900: 'Nach 15 Minuten',
  };

  /// Human label for an arbitrary grace value (falls back to the nearest known
  /// option's wording, then to a generic "Nach N Sekunden").
  static String graceLabel(int seconds) {
    if (graceOptions.containsKey(seconds)) return graceOptions[seconds]!;
    if (seconds <= 0) return graceOptions[0]!;
    if (seconds < 60) return 'Nach $seconds Sekunden';
    final mins = seconds ~/ 60;
    return 'Nach $mins Minute${mins == 1 ? '' : 'n'}';
  }

  /// Whether the app should re-lock given how long it was in the background.
  /// Locks only when a PIN is configured.
  static bool shouldLock({
    required bool enabled,
    required String pinHash,
    required int graceSeconds,
    required Duration backgrounded,
  }) {
    if (!enabled || pinHash.isEmpty) return false;
    return backgrounded.inSeconds >= graceSeconds;
  }
}
