import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'services/app_state.dart';
import 'services/push_service.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('de');

  // Firebase backs phone-number verification. Only Android is configured (via
  // android/app/google-services.json); on other platforms we just skip it and
  // registration proceeds without the extra check.
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    try {
      await Firebase.initializeApp();
      // Handle push messages that arrive while the app is in the background or
      // terminated (the OS shows the notification; this keeps FCM delivering).
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    } catch (_) {
      // Verification/push will be unavailable; the app still works otherwise.
    }
  }

  final state = AppState();
  // Kick off bootstrap; the UI shows a splash until it resolves.
  state.init();

  runApp(
    ChangeNotifierProvider.value(value: state, child: const PingApp()),
  );
}

class PingApp extends StatelessWidget {
  const PingApp({super.key});

  @override
  Widget build(BuildContext context) {
    final themeMode = context.select<AppState, ThemeMode>((s) => s.themeMode);
    // Rebuild themes whenever the chosen design (preset or custom seed) changes.
    final design = context.select<AppState, PingDesign>((s) => s.design);
    return MaterialApp(
      title: 'Ping',
      debugShowCheckedModeBanner: false,
      theme: PingTheme.light(design),
      darkTheme: PingTheme.dark(design),
      themeMode: themeMode,
      home: const _Root(),
    );
  }
}

/// Switches between splash, login and the main app based on auth status.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final status = context.select<AppState, AuthStatus>((s) => s.status);
    final (key, child) = switch (status) {
      AuthStatus.unknown => ('splash', const SplashScreen()),
      AuthStatus.signedOut => ('login', const LoginScreen()),
      AuthStatus.signedIn => ('home', const HomeScreen()),
    };
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      child: KeyedSubtree(key: ValueKey(key), child: child),
    );
  }
}
