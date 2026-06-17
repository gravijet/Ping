import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_windows/webview_windows.dart';

import '../services/windows_native.dart';
import '../services/windows_update_service.dart';

/// The Windows desktop build is a thin shell: instead of a second Flutter copy
/// of the messenger, it hosts the dedicated PC web client (Ping Web) inside an
/// Edge WebView2 view. One PC UI for both the browser and Windows — see
/// server/public/webclient. Android/iOS still run the full native app.
const String kWebClientUrl = 'https://example.invalid';

/// Ping's brand blue, reused across the few native chrome elements the shell
/// draws (boot splash, update screen, runtime-missing screen).
const Color _kBg = Color(0xFF07090E);
const Color _kAccent = Color(0xFF4D9BFF);

/// Minimal MaterialApp used only on Windows. Kept separate from the full
/// [PingApp] so the desktop shell never spins up AppState/Firebase/etc.
class WindowsWebShellApp extends StatelessWidget {
  const WindowsWebShellApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ping',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _kBg,
        fontFamily: 'PlusJakartaSans',
        colorScheme: const ColorScheme.dark(primary: _kAccent),
      ),
      home: const WindowsWebShell(),
    );
  }
}

class WindowsWebShell extends StatefulWidget {
  const WindowsWebShell({super.key});

  @override
  State<WindowsWebShell> createState() => _WindowsWebShellState();
}

class _WindowsWebShellState extends State<WindowsWebShell> {
  final _controller = WebviewController();
  final _updater = WindowsUpdateService(kWebClientUrl);
  late final WindowsNative _native =
      WindowsNative((msg) => _postToWeb(msg));
  bool _ready = false; // WebView painted
  String? _error;
  bool _updateDismissed = false;

  // The launch-time (Discord-style) update step has finished and we may reveal
  // the app. Until then the update overlay covers everything.
  bool _startupDone = false;
  // Show a "skip" affordance once the update step has taken a moment, so a slow
  // server or a large download never traps the user on the splash.
  bool _showSkip = false;

  @override
  void initState() {
    super.initState();
    _updater.addListener(_onUpdate);
    _native.init();
    _startup();
  }

  void _postToWeb(Map<String, dynamic> msg) {
    try {
      _controller.postWebMessage(jsonEncode(msg));
    } catch (_) {/* web view not ready yet */}
  }

  Future<void> _startup() async {
    // Initialise the WebView in parallel with the update check so it's ready to
    // reveal the instant the update step clears.
    final webViewFuture = _initWebView();

    // Reveal a "skip" button if the update step lingers.
    Future<void>.delayed(const Duration(seconds: 6), () {
      if (mounted && !_startupDone) setState(() => _showSkip = true);
    });

    // Block on the update check/download/install. Returns quickly when there's
    // nothing new; on a real update the process exits and never reaches here.
    await _updater.runStartupUpdate();
    if (mounted) setState(() => _startupDone = true);

    // Arm the periodic background fallback for long sessions.
    _updater.start();
    await webViewFuture;
  }

  void _onUpdate() {
    if (mounted) setState(() {});
  }

  Future<void> _initWebView() async {
    try {
      await _controller.initialize();
      await _controller.setBackgroundColor(_kBg);
      await _controller.setPopupWindowPolicy(WebviewPopupWindowPolicy.deny);
      // Bridge: the web client posts JSON (unread/notify/autostart/…) and we
      // drive the tray, OS notifications and the taskbar indicator.
      _controller.webMessage.listen(_native.handleWebMessage);
      await _controller.loadUrl(kWebClientUrl);
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      // The usual cause is a missing Edge WebView2 runtime.
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _updater.removeListener(_onUpdate);
    _updater.dispose();
    _native.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        backgroundColor: _kBg,
        body: _RuntimeMissing(onRetry: () {
          setState(() => _error = null);
          _initWebView();
        }),
      );
    }

    final updating = !_startupDone &&
        (_updater.stage == DesktopUpdateStage.checking ||
            _updater.stage == DesktopUpdateStage.downloading ||
            _updater.stage == DesktopUpdateStage.installing);

    // After the launch update clears, a newer build found later in the session
    // (background timer) surfaces as a restart banner instead.
    final showBanner = _startupDone &&
        _updater.stage == DesktopUpdateStage.ready &&
        !_updateDismissed;

    return Scaffold(
      backgroundColor: _kBg,
      body: Stack(
        children: [
          if (_ready) Positioned.fill(child: Webview(_controller)),
          if (!_ready || updating)
            Positioned.fill(
              child: updating
                  ? _UpdateScreen(
                      stage: _updater.stage,
                      progress: _updater.progress,
                      version: _updater.ready?.version ?? '',
                      showSkip: _showSkip &&
                          _updater.stage != DesktopUpdateStage.installing,
                      onSkip: () {
                        _updater.skipStartup();
                        setState(() => _startupDone = true);
                      },
                    )
                  : const _Boot(),
            ),
          if (showBanner)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _UpdateBanner(
                version: _updater.ready?.version ?? '',
                onLater: () => setState(() => _updateDismissed = true),
                onRestart: () => _updater.installAndRestart(),
              ),
            ),
        ],
      ),
    );
  }
}

/// Branded loading state shown until the WebView has the client painted.
class _Boot extends StatelessWidget {
  const _Boot();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _kBg,
      child: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Ping',
                style: TextStyle(
                    color: _kAccent, fontSize: 38, fontWeight: FontWeight.w800)),
            SizedBox(height: 22),
            SizedBox(
                width: 28,
                height: 28,
                child:
                    CircularProgressIndicator(strokeWidth: 3, color: _kAccent)),
          ],
        ),
      ),
    );
  }
}

/// Full-screen, Discord-style update screen shown on launch while Ping checks
/// for, downloads and installs a newer build — before the messenger appears.
class _UpdateScreen extends StatelessWidget {
  final DesktopUpdateStage stage;
  final double progress;
  final String version;
  final bool showSkip;
  final VoidCallback onSkip;
  const _UpdateScreen({
    required this.stage,
    required this.progress,
    required this.version,
    required this.showSkip,
    required this.onSkip,
  });

  @override
  Widget build(BuildContext context) {
    final downloading = stage == DesktopUpdateStage.downloading;
    final pct = (progress * 100).clamp(0, 100).toStringAsFixed(0);
    final label = switch (stage) {
      DesktopUpdateStage.downloading => version.isEmpty
          ? 'Update wird geladen … $pct %'
          : 'Version $version wird geladen … $pct %',
      DesktopUpdateStage.installing => 'Update wird installiert …',
      _ => 'Suche nach Updates …',
    };
    return Container(
      color: _kBg,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Ping',
                style: TextStyle(
                    color: _kAccent, fontSize: 40, fontWeight: FontWeight.w800)),
            const SizedBox(height: 28),
            SizedBox(
              width: 260,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  minHeight: 6,
                  value: downloading ? progress.clamp(0.0, 1.0) : null,
                  backgroundColor: const Color(0x224D9BFF),
                  valueColor: const AlwaysStoppedAnimation(_kAccent),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(label,
                style: const TextStyle(
                    color: Color(0xFF9AA7BD),
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 26),
            // Escape hatch so a slow server or huge download never blocks launch.
            AnimatedOpacity(
              opacity: showSkip ? 1 : 0,
              duration: const Duration(milliseconds: 250),
              child: TextButton(
                onPressed: showSkip ? onSkip : null,
                style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF7E8BA3)),
                child: const Text('Überspringen und Ping öffnen'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bottom banner shown once a newer build's installer has finished downloading
/// in the background during a long session — a single "Neu starten" applies it.
class _UpdateBanner extends StatelessWidget {
  final String version;
  final VoidCallback onLater;
  final VoidCallback onRestart;
  const _UpdateBanner({
    required this.version,
    required this.onLater,
    required this.onRestart,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Container(
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF12203A), Color(0xFF0E1726)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0x334D9BFF)),
            boxShadow: const [
              BoxShadow(
                  color: Color(0x66000000),
                  blurRadius: 30,
                  offset: Offset(0, 12)),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: const BoxDecoration(
                    color: Color(0x294D9BFF), shape: BoxShape.circle),
                child:
                    const Icon(Icons.check_rounded, color: _kAccent, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      version.isEmpty
                          ? 'Update geladen'
                          : 'Version $version geladen',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    const Text('Zum Anwenden kurz neu starten.',
                        style:
                            TextStyle(color: Color(0xFF9AA7BD), fontSize: 13)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: onLater,
                style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF9AA7BD)),
                child: const Text('Später'),
              ),
              const SizedBox(width: 4),
              FilledButton(
                onPressed: onRestart,
                style: FilledButton.styleFrom(
                  backgroundColor: _kAccent,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Neu starten'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown when WebView2 can't initialize (almost always: the Evergreen runtime
/// isn't installed). The installer normally bootstraps it, but offer a manual
/// download as a fallback.
class _RuntimeMissing extends StatelessWidget {
  final VoidCallback onRetry;
  const _RuntimeMissing({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.public_off_rounded, color: _kAccent, size: 56),
            const SizedBox(height: 18),
            const Text('Microsoft Edge WebView2 wird benötigt',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            const Text(
              'Ping für Windows zeigt die Web-Oberfläche über die '
              'WebView2-Laufzeit an. Bitte installiere sie und starte Ping neu.',
              textAlign: TextAlign.center,
              style:
                  TextStyle(color: Color(0xFF9AA7BD), fontSize: 15, height: 1.5),
            ),
            const SizedBox(height: 22),
            Wrap(
              spacing: 12,
              children: [
                FilledButton(
                  onPressed: () => launchUrl(
                    Uri.parse(
                        'https://go.microsoft.com/fwlink/p/?LinkId=2124703'),
                    mode: LaunchMode.externalApplication,
                  ),
                  child: const Text('WebView2 installieren'),
                ),
                OutlinedButton(
                  onPressed: onRetry,
                  child: const Text('Erneut versuchen'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
