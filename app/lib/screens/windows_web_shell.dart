import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_windows/webview_windows.dart';

/// The Windows desktop build is a thin shell: instead of a second Flutter copy
/// of the messenger, it hosts the dedicated PC web client (Ping Web) inside an
/// Edge WebView2 view. One PC UI for both the browser and Windows — see
/// server/public/webclient. Android/iOS still run the full native app.
const String kWebClientUrl = 'https://example.invalid';

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
        scaffoldBackgroundColor: const Color(0xFF07090E),
        colorScheme: const ColorScheme.dark(primary: Color(0xFF4D9BFF)),
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
  bool _ready = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      await _controller.initialize();
      await _controller.setBackgroundColor(const Color(0xFF07090E));
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
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07090E),
      body: _error != null
          ? _RuntimeMissing(onRetry: () {
              setState(() => _error = null);
              _init();
            })
          : Stack(
              children: [
                if (_ready) Positioned.fill(child: Webview(_controller)),
                if (!_ready)
                  const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Ping',
                            style: TextStyle(
                                color: Color(0xFF4D9BFF),
                                fontSize: 34,
                                fontWeight: FontWeight.w800)),
                        SizedBox(height: 22),
                        SizedBox(
                            width: 30,
                            height: 30,
                            child: CircularProgressIndicator(
                                strokeWidth: 3, color: Color(0xFF4D9BFF))),
                      ],
                    ),
                  ),
              ],
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
            const Icon(Icons.public_off_rounded,
                color: Color(0xFF4D9BFF), size: 56),
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
              style: TextStyle(color: Color(0xFF9AA7BD), fontSize: 15, height: 1.5),
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
