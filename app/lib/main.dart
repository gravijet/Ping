import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'screens/call_screen.dart';
import 'screens/home_screen.dart';
import 'screens/lock_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/windows_web_shell.dart';
import 'services/app_state.dart';
import 'services/crash_service.dart';
import 'services/push_service.dart';
import 'theme.dart';

/// App-wide keys so background events (forced logout, notification taps) can
/// reach the UI even across route changes.
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> scaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

void main() {
  // Run the whole app inside a guarded zone so *asynchronous* errors are caught
  // by the on-device crash reporter instead of vanishing into the void. Flutter
  // requires the binding to be initialised in the same zone that calls runApp,
  // so the entire bootstrap lives inside this closure.
  CrashService.instance.guard(() async {
    WidgetsFlutterBinding.ensureInitialized();

    // Windows is a thin shell around the PC web client (Ping Web): it just hosts
    // a WebView2 view, so it skips the full native bootstrap (AppState, Firebase,
    // locale data) entirely. Android/iOS continue with the full app below.
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.windows) {
      runApp(const WindowsWebShellApp());
      return;
    }

    // Capture framework + uncaught platform errors on-device. Strictly local —
    // reports are kept in a small ring buffer and shown under Einstellungen →
    // Diagnose; nothing is ever transmitted. Loading past reports is best-effort.
    CrashService.instance.install();
    unawaited(CrashService.instance.load());

    // Locale data for date/time formatting. A failure here must never block the
    // first frame — fall back to the default locale rather than hang on the
    // native launch screen (the "stuck on a grey screen after install" report).
    try {
      await initializeDateFormatting('de').timeout(const Duration(seconds: 5));
    } catch (_) {
      /* dates fall back to the default locale; the app still renders */
    }

    // Firebase backs push notifications (and, on older builds, phone verify).
    // Only Android is configured (via android/app/google-services.json); on
    // other platforms we just skip it and everything else still works. A cold
    // device without Google Play Services can make this hang, so it's time-boxed
    // — we'd rather start without push than never paint a frame.
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      try {
        await Firebase.initializeApp().timeout(const Duration(seconds: 8));
        // Handle push messages that arrive while the app is in the background or
        // terminated (the OS shows the notification; this keeps FCM delivering).
        FirebaseMessaging.onBackgroundMessage(
            firebaseMessagingBackgroundHandler);
      } catch (_) {
        // Verification/push will be unavailable; the app still works otherwise.
      }
    }

    // In release builds an uncaught widget error renders a bare grey screen with
    // no way out. Show a branded, actionable fallback instead so a first-launch
    // glitch is recoverable rather than a dead end. (FlutterError.onError, hooked
    // by CrashService.install above, already records the underlying error.)
    ErrorWidget.builder = (details) => const _FatalErrorScreen();

    final state = AppState();
    // Forward redacted crash reports (Fehlerberichte) to the developer bug inbox
    // when the 'errorReporting' flag is on. On-device capture above is unchanged;
    // this just hands the developer (and a fresh Claude session) the real
    // crashes to fix. Best-effort — a reporting failure never disturbs the app.
    CrashService.instance.sender = (payload) async {
      if (!state.feature('errorReporting', fallback: true)) return;
      try {
        await state.api.post('/client-error', payload);
      } catch (_) {/* offline / server down — the on-device copy still exists */}
    };
    // Kick off bootstrap; the UI shows a splash until it resolves. Guarded so a
    // bootstrap exception can't leave the app stranded on the splash forever.
    state.init().catchError((Object e) => state.failBootstrap(e));

    runApp(
      ChangeNotifierProvider.value(value: state, child: PingApp(state: state)),
    );
  });
}

/// Last-resort UI shown when a widget subtree throws during build. Replaces
/// Flutter's default grey error box with something a user can act on.
class _FatalErrorScreen extends StatelessWidget {
  const _FatalErrorScreen();

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Container(
        color: const Color(0xFF0A84FF),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(28),
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.refresh_rounded, color: Colors.white, size: 48),
            SizedBox(height: 16),
            Text(
              'Etwas ist schiefgelaufen.\nBitte starte Ping neu.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 17,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
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
    final amoled = context.select<AppState, bool>((s) => s.settings.amoledDark);
    final boldText =
        context.select<AppState, bool>((s) => s.settings.boldText);
    final highContrast =
        context.select<AppState, bool>((s) => s.settings.highContrast);
    final reduceMotion =
        context.select<AppState, bool>((s) => s.settings.reduceMotion);
    // Developer aid (Entwickleroptionen): Flutter's GPU/UI frame-time graphs.
    final showPerfOverlay =
        context.select<AppState, bool>((s) => s.settings.showPerformanceOverlay);
    return MaterialApp(
      title: 'Ping',
      debugShowCheckedModeBanner: false,
      showPerformanceOverlay: showPerfOverlay,
      navigatorKey: navigatorKey,
      scaffoldMessengerKey: scaffoldMessengerKey,
      theme: PingTheme.light(design,
          boldText: boldText,
          highContrast: highContrast,
          reduceMotion: reduceMotion),
      darkTheme: PingTheme.dark(design,
          amoled: amoled,
          boldText: boldText,
          highContrast: highContrast,
          reduceMotion: reduceMotion),
      themeMode: themeMode,
      // The call overlay floats above every screen so an incoming call rings
      // wherever the user is. The app-lock gate sits above even that, so a
      // locked phone reveals nothing — not even an incoming call's details.
      builder: (context, child) => _AppLockGate(
        child: CallOverlay(child: child ?? const SizedBox.shrink()),
      ),
      home: const _Root(),
    );
  }
}

/// Overlays the PIN [LockScreen] above everything whenever the local app-lock is
/// engaged and the user is signed in. Rendered from `MaterialApp.builder` so it
/// covers the call overlay too.
class _AppLockGate extends StatelessWidget {
  final Widget child;
  const _AppLockGate({required this.child});

  @override
  Widget build(BuildContext context) {
    final locked = context.select<AppState, bool>(
        (s) => s.appLocked && s.status == AuthStatus.signedIn);
    return Stack(
      children: [
        child,
        if (locked)
          const Positioned.fill(
            child: LockScreen(),
          ),
      ],
    );
  }
}

/// Switches between splash, login and the main app based on auth status.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final status = context.select<AppState, AuthStatus>((s) => s.status);
    final reduceMotion =
        context.select<AppState, bool>((s) => s.settings.reduceMotion);
    final (key, child) = switch (status) {
      AuthStatus.unknown => ('splash', const SplashScreen()),
      AuthStatus.signedOut => ('login', const LoginScreen()),
      AuthStatus.signedIn => ('home', const HomeScreen()),
    };
    return AnimatedSwitcher(
      duration: Duration(milliseconds: reduceMotion ? 0 : 350),
      child: KeyedSubtree(key: ValueKey(key), child: child),
    );
  }
}
