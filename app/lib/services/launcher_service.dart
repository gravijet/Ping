import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Android launcher integration: publishes **dynamic app shortcuts** (long-press
/// the home-screen icon → jump into a recent chat) and routes the deep link a
/// tapped shortcut / notification carries back into the app.
///
/// Talks to the same `ping/native` MethodChannel as the rest of the native
/// bridge (MainActivity.kt). Android-only; every method is a safe no-op on the
/// web and Windows builds so callers never special-case the platform.
class LauncherService {
  static const _channel = MethodChannel('ping/native');

  bool get _supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Called when a launching shortcut/notification deep link arrives while the
  /// app is already running, with an encoded route (`chat:<id>` / `route:<n>`).
  void Function(String route)? onLaunchRoute;

  bool _wired = false;

  /// Start listening for inbound deep-link routes from the native side. Safe to
  /// call once during bootstrap.
  void wire() {
    if (_wired || !_supported) return;
    _wired = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'launchRoute' && call.arguments is String) {
        onLaunchRoute?.call(call.arguments as String);
      }
      return null;
    });
  }

  /// The deep-link route the app was cold-launched with (or null), consumed once.
  Future<String?> consumeLaunchRoute() async {
    if (!_supported) return null;
    try {
      return await _channel.invokeMethod<String>('consumeLaunchRoute');
    } catch (_) {
      return null;
    }
  }

  /// Publish up to four recent chats as launcher shortcuts. Each entry is a
  /// (chatId, label) pair; the most relevant chat should come first.
  Future<void> setChatShortcuts(List<({String chatId, String label})> chats) async {
    if (!_supported) return;
    try {
      await _channel.invokeMethod('setChatShortcuts', {
        'chats': [
          for (final c in chats.take(4))
            {'chatId': c.chatId, 'label': c.label},
        ],
      });
    } catch (_) {
      /* shortcuts are a nicety — never surface a failure */
    }
  }
}
