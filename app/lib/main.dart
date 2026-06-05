import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/profile_setup_screen.dart';
import 'screens/splash_screen.dart';
import 'services/app_state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('de');

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
    return MaterialApp(
      title: 'Ping',
      debugShowCheckedModeBanner: false,
      theme: PingTheme.light(),
      darkTheme: PingTheme.dark(),
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
    final needsSetup =
        context.select<AppState, bool>((s) => s.needsProfileSetup);
    final (key, child) = switch (status) {
      AuthStatus.unknown => ('splash', const SplashScreen()),
      AuthStatus.signedOut => ('login', const LoginScreen()),
      AuthStatus.signedIn => needsSetup
          ? ('setup', const ProfileSetupScreen())
          : ('home', const HomeScreen()),
    };
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      child: KeyedSubtree(key: ValueKey(key), child: child),
    );
  }
}
