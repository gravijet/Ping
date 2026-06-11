import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// Drives the server-side SMS verification for [phone] and pops with a
/// short-lived **verification token** (a `String`) that registration accepts as
/// proof of phone ownership — or `null` if the user backs out.
///
/// The server texts a one-time code (or, with the free 'log' provider, returns
/// it for testing). This replaces the old Firebase phone-auth flow, so SMS works
/// without any Firebase console setup.
class PhoneVerifyScreen extends StatefulWidget {
  final String phone;

  /// Why the number is being verified: 'register' (default) or 'reset'
  /// (forgot password). The server checks the account state accordingly.
  final String purpose;

  const PhoneVerifyScreen(
      {super.key, required this.phone, this.purpose = 'register'});

  @override
  State<PhoneVerifyScreen> createState() => _PhoneVerifyScreenState();
}

enum _Step { sending, code, verifying }

class _PhoneVerifyScreenState extends State<PhoneVerifyScreen> {
  final _code = TextEditingController();

  _Step _step = _Step.sending;
  String? _error;
  String? _devCode; // present only with the test SMS provider

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
      final res = await context
          .read<AppState>()
          .requestPhoneCode(widget.phone, purpose: widget.purpose);
      if (!mounted) return;
      setState(() {
        _step = _Step.code;
        _devCode = res['devCode'] as String?;
        if (_devCode != null) _code.text = _devCode!; // pre-fill in test mode
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _step = _Step.code;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Verifizierung konnte nicht gestartet werden.';
        _step = _Step.code;
      });
    }
  }

  Future<void> _confirm() async {
    final code = _code.text.trim();
    if (code.length < 4) {
      setState(() => _error = 'Bitte gib den Code aus der SMS ein.');
      return;
    }
    setState(() {
      _step = _Step.verifying;
      _error = null;
    });
    try {
      final token =
          await context.read<AppState>().verifyPhoneCode(widget.phone, code);
      if (!mounted) return;
      Navigator.of(context).pop(token);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _step = _Step.code;
      });
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
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 8),
            Center(
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [scheme.primary, scheme.secondary],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: scheme.primary.withValues(alpha: 0.4),
                      blurRadius: 24,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: const Icon(Icons.sms_rounded, size: 38, color: Colors.white),
              ),
            ),
            const SizedBox(height: 22),
            Text(
              'Wir bestätigen deine Nummer',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(
              'An ${widget.phone} senden wir einen Code per SMS. Gib ihn hier ein.',
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
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: const TextStyle(
                    fontSize: 26, letterSpacing: 10, fontWeight: FontWeight.w800),
                decoration: const InputDecoration(
                  counterText: '',
                  hintText: '••••••',
                ),
                onSubmitted: (_) => _confirm(),
              ),
              if (_devCode != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: scheme.tertiaryContainer.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.science_rounded,
                          size: 18, color: scheme.onTertiaryContainer),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Testmodus: Es wird keine echte SMS versendet. Dein Code '
                          'lautet $_devCode (bereits eingetragen).',
                          style: TextStyle(
                              fontSize: 12.5, color: scheme.onTertiaryContainer),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
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
    );
  }
}
