import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/phone_verification_service.dart';

/// Drives Firebase phone verification for [e164Phone] and pops with the
/// resulting Firebase ID token (a `String`), or `null` if the user backs out.
class PhoneVerifyScreen extends StatefulWidget {
  final String e164Phone;
  const PhoneVerifyScreen({super.key, required this.e164Phone});

  @override
  State<PhoneVerifyScreen> createState() => _PhoneVerifyScreenState();
}

enum _Step { sending, code, verifying }

class _PhoneVerifyScreenState extends State<PhoneVerifyScreen> {
  final _service = PhoneVerificationService();
  final _code = TextEditingController();

  _Step _step = _Step.sending;
  String? _verificationId;
  String? _error;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _step = _Step.sending;
      _error = null;
    });
    try {
      await _service.start(
        widget.e164Phone,
        onAutoVerified: (idToken) {
          if (mounted) Navigator.of(context).pop(idToken);
        },
        onCodeSent: (verificationId) {
          if (!mounted) return;
          setState(() {
            _verificationId = verificationId;
            _step = _Step.code;
          });
        },
        onError: (message) {
          if (!mounted) return;
          setState(() {
            _error = message;
            _step = _Step.code; // let them retry / re-send
          });
        },
      );
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Verifizierung konnte nicht gestartet werden.';
          _step = _Step.code;
        });
      }
    }
  }

  Future<void> _confirm() async {
    final id = _verificationId;
    final code = _code.text.trim();
    if (id == null || code.length < 4) {
      setState(() => _error = 'Bitte gib den Code aus der SMS ein.');
      return;
    }
    setState(() {
      _step = _Step.verifying;
      _error = null;
    });
    try {
      final token = await _service.confirmCode(id, code);
      if (!mounted) return;
      if (token != null) {
        Navigator.of(context).pop(token);
      } else {
        setState(() {
          _error = 'Code stimmt nicht. Bitte erneut versuchen.';
          _step = _Step.code;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Code stimmt nicht oder ist abgelaufen.';
        _step = _Step.code;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Nummer bestätigen')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Icon(Icons.sms_rounded, size: 56, color: scheme.primary),
              const SizedBox(height: 16),
              Text(
                'Wir bestätigen deine Nummer',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'An ${widget.e164Phone} wird ein Code per SMS gesendet. Auf vielen '
                'Android-Geräten erkennt Ping ihn automatisch.',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 28),
              if (_step == _Step.sending) ...[
                const Center(child: CircularProgressIndicator()),
                const SizedBox(height: 12),
                Center(
                  child: Text('SMS wird gesendet …',
                      style: TextStyle(color: scheme.onSurfaceVariant)),
                ),
              ] else ...[
                TextField(
                  controller: _code,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 6,
                  enabled: _step != _Step.verifying,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                  ],
                  style: const TextStyle(
                      fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w700),
                  decoration: const InputDecoration(
                    counterText: '',
                    hintText: '••••••',
                  ),
                  onSubmitted: (_) => _confirm(),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _step == _Step.verifying ? null : _confirm,
                  child: _step == _Step.verifying
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.4, color: Colors.white),
                        )
                      : const Text('Bestätigen'),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _step == _Step.verifying ? null : _start,
                  child: const Text('Code erneut senden'),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
