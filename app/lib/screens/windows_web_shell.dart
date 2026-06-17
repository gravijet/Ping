import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_windows/webview_windows.dart';

import '../services/windows_update_service.dart';

/// The Windows desktop build is a thin shell: instead of a second Flutter copy
/// of the messenger, it hosts the dedicated PC web client (Ping Web) inside an
/// Edge WebView2 view. One PC UI for both the browser and Windows — see
/// server/public/webclient. Android/iOS still run the full native app.
const String kWebClientUrl = 'https://example.invalid';

/// Ping's brand blue, reused across the few native chrome elements the shell
/// draws (boot splash, update banner, runtime-missing screen).
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
  bool _ready = false;
  String? _error;
  bool _updateDismissed = false;

  @override
  void initState() {
    super.initState();
    _updater.addListener(_onUpdate);
    _updater.start();
    _init();
  }

  void _onUpdate() {
    if (mounted) setState(() {});
  }

  Future<void> _init() async {
    try {
      await _controller.initialize();
      await _controller.setBackgroundColor(_kBg);
      await _controller.setPopupWindowPolicy(WebviewPopupWindowPolicy.deny);
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
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final showUpdate =
        _updater.stage == DesktopUpdateStage.ready && !_updateDismissed;
    return Scaffold(
      backgroundColor: _kBg,
      body: _error != null
          ? _RuntimeMissing(onRetry: () {
              setState(() => _error = null);
              _init();
            })
          : Stack(
              children: [
                if (_ready) Positioned.fill(child: Webview(_controller)),
                if (!_ready) const _Boot(),
                if (showUpdate)
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
    return const Center(
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
              child: CircularProgressIndicator(
                  strokeWidth: 3, color: _kAccent)),
        ],
      ),
    );
  }
}

/// Bottom banner shown once a newer build's installer has finished downloading
/// in the background. Matches the agreed UX: silent download, then a single
/// "Neu starten" to apply it.
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
                child: const Icon(Icons.check_rounded,
                    color: _kAccent, size: 22),
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
                        style: TextStyle(
                            color: Color(0xFF9AA7BD), fontSize: 13)),
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
