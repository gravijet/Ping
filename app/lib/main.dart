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

/// App-wide keys so background events (forced logout, notification taps) can
/// reach the UI even across route changes.
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> scaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('de');

  // Firebase backs push notifications (and, on older builds, phone verify). Only
  // Android is configured (via android/app/google-services.json); on other
  // platforms we just skip it and everything else still works.
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
    ChangeNotifierProvider.value(value: state, child: PingApp(state: state)),
  );
}

class PingApp extends StatefulWidget {
  final AppState state;
  const PingApp({super.key, required this.state});

  @override
  State<PingApp> createState() => _PingAppState();
}

class _PingAppState extends State<PingApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Surface forced logouts (account disabled/deleted by an admin) to the user.
    widget.state.onForcedLogout = _onForcedLogout;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    switch (lifecycle) {
      case AppLifecycleState.resumed:
        widget.state.appResumed();
        break;
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        widget.state.appPaused();
        break;
      case AppLifecycleState.inactive:
        break;
    }
  }

  void _onForcedLogout(String reason) {
    final text = reason == 'deleted'
        ? 'Dein Konto wurde von einem Administrator gelöscht.'
        : 'Dein Konto wurde gesperrt. Bitte wende dich an den Support.';
    scaffoldMessengerKey.currentState
      ?..clearSnackBars()
      ..showSnackBar(SnackBar(
        content: Text(text),
        duration: const Duration(seconds: 6),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = context.select<AppState, ThemeMode>((s) => s.themeMode);
    // Rebuild themes whenever the chosen design (preset or custom seed) changes.
    final design = context.select<AppState, PingDesign>((s) => s.design);
    return MaterialApp(
      title: 'Ping',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      scaffoldMessengerKey: scaffoldMessengerKey,
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
