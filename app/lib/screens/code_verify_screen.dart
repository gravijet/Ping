import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// Second onboarding screen: enter the login code sent to [phone].
class CodeVerifyScreen extends StatefulWidget {
  final String phone;
  final String? devCode;
  const CodeVerifyScreen({super.key, required this.phone, this.devCode});

  @override
  State<CodeVerifyScreen> createState() => _CodeVerifyScreenState();
}

class _CodeVerifyScreenState extends State<CodeVerifyScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _devCode;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _devCode = widget.devCode;
    if (_devCode != null) _code.text = _devCode!;
    _startCooldown();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startCooldown() {
    _timer?.cancel();
    setState(() => _resendIn = 30);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _resendIn--);
      if (_resendIn <= 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (code.length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bitte gib den Code ein.')),
      );
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    try {
      await context.read<AppState>().verifyCode(widget.phone, code);
      if (!mounted) return;
      // Drop back to the root; _Root now shows home (or profile setup).
      Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _resend() async {
    setState(() => _busy = true);
    try {
      final res = await context.read<AppState>().requestCode(widget.phone);
      if (!mounted) return;
      setState(() {
        _devCode = res['devCode'] as String?;
        if (_devCode != null) _code.text = _devCode!;
      });
      _startCooldown();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Neuer Code gesendet.')),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Nummer bestätigen')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.sms_rounded, size: 56, color: scheme.primary),
                  const SizedBox(height: 18),
                  Text(
                    'Code eingeben',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Wir haben einen Code an ${widget.phone} geschickt.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _code,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    maxLength: 8,
                    onSubmitted: (_) => _verify(),
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                    ],
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 8,
                    ),
                    decoration: const InputDecoration(
                      counterText: '',
                      hintText: '••••••',
                    ),
                  ),
                  if (_devCode != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: scheme.secondaryContainer,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.info_outline_rounded,
                              size: 20, color: scheme.onSecondaryContainer),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Demo-Modus (kein SMS-Versand): Dein Code lautet '
                              '$_devCode und ist schon eingetragen.',
                              style: TextStyle(
                                  color: scheme.onSecondaryContainer,
                                  fontSize: 12.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _busy ? null : _verify,
                    child: _busy
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
                    onPressed: (_busy || _resendIn > 0) ? null : _resend,
                    child: Text(_resendIn > 0
                        ? 'Code erneut senden ($_resendIn s)'
                        : 'Code erneut senden'),
                  ),
                  TextButton(
                    onPressed:
                        _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Andere Nummer verwenden'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
