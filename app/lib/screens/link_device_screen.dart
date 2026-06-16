import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// The QR a desktop shows is `ping-link:<code>`. Kept here so the scanner (this
/// screen) and the desktop QR renderer (login_screen) agree on the format.
const String kLinkQrPrefix = 'ping-link:';

/// Extracts the link code from a scanned QR value, or null if it isn't ours.
String? parseLinkCode(String? raw) {
  if (raw == null) return null;
  final s = raw.trim();
  if (!s.startsWith(kLinkQrPrefix)) return null;
  final code = s.substring(kLinkQrPrefix.length).trim();
  return code.isEmpty ? null : code;
}

/// "Verknüpfte Geräte" — scan the QR shown by Ping in the browser (web app) or
/// the Windows desktop app to sign that device into this account (WhatsApp-Web
/// style). Reached from Settings on the phone.
class LinkDeviceScreen extends StatefulWidget {
  const LinkDeviceScreen({super.key});

  @override
  State<LinkDeviceScreen> createState() => _LinkDeviceScreenState();
}

class _LinkDeviceScreenState extends State<LinkDeviceScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _handling = false; // ignore further scans while we approve one

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handling) return;
    String? code;
    for (final barcode in capture.barcodes) {
      code = parseLinkCode(barcode.rawValue);
      if (code != null) break;
    }
    if (code == null) return;

    setState(() => _handling = true);
    // Capture context-bound objects up front so we never touch `context` across
    // an await (the scanner work is all async).
    final appState = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    await _controller.stop();
    if (!mounted) return;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => _ConfirmSheet(),
    );
    if (confirmed != true) {
      // User declined — resume scanning for another code.
      if (mounted) {
        setState(() => _handling = false);
        await _controller.start();
      }
      return;
    }

    try {
      await appState.approveDeviceLink(code, deviceLabel: 'Verknüpftes Gerät');
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(
            content: Text('Gerät verknüpft. Du bist jetzt dort angemeldet.')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
      if (mounted) setState(() => _handling = false);
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Gerät verknüpfen')),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: _onDetect,
                  errorBuilder: (context, error) => _ScannerError(error: error),
                ),
                // A simple viewfinder frame to aim the QR into.
                Center(
                  child: Container(
                    width: 240,
                    height: 240,
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.white70, width: 3),
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                ),
                if (_handling)
                  Container(
                    color: Colors.black54,
                    alignment: Alignment.center,
                    child: const CircularProgressIndicator(color: Colors.white),
                  ),
              ],
            ),
          ),
          Container(
            width: double.infinity,
            color: scheme.surface,
            padding: const EdgeInsets.fromLTRB(24, 22, 24, 30),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Ping Web oder PC anmelden',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(
                  'Öffne Ping im Browser (Ping Web) oder auf deinem Windows-PC und '
                  'halte den dort angezeigten QR-Code vor die Kamera. Danach ist '
                  'das Gerät mit deinem Konto verbunden.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ConfirmSheet extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.desktop_windows_rounded, size: 44, color: scheme.primary),
            const SizedBox(height: 14),
            Text('Windows-Gerät anmelden?',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 10),
            Text(
              'Damit erhält dieser PC vollen Zugriff auf deine Chats. Tu das nur '
              'mit einem Gerät, das dir gehört.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Anmelden'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Abbrechen'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error});
  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    final msg = switch (error.errorCode) {
      MobileScannerErrorCode.permissionDenied =>
        'Ping braucht Kamerazugriff, um den QR-Code zu scannen. Erlaube ihn in den Einstellungen.',
      _ => 'Die Kamera konnte nicht gestartet werden.',
    };
    return Container(
      color: Colors.black,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(28),
      child: Text(
        msg,
        textAlign: TextAlign.center,
        style: const TextStyle(color: Colors.white),
      ),
    );
  }
}
