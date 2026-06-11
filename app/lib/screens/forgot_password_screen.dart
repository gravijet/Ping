import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import 'phone_verify_screen.dart';

/// Forgot password: enter the account's phone number, prove ownership via the
/// SMS code (the same [PhoneVerifyScreen] used for registration, but with
/// purpose 'reset'), then choose a new password. On success the user is signed
/// straight in — the root widget swaps to the home screen automatically.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _password = TextEditingController();

  String? _verifyToken; // set once the SMS code was confirmed
  String? _verifiedPhone;
  bool _busy = false;
  bool _showPassword = false;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _verified => _verifyToken != null;

  Future<void> _startVerification() async {
    final phone = _phone.text.trim();
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 5) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Bitte gib eine gültige Handynummer ein.')));
      return;
    }
    FocusScope.of(context).unfocus();
    final token = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => PhoneVerifyScreen(phone: phone, purpose: 'reset'),
      ),
    );
    if (token != null && mounted) {
      setState(() {
        _verifyToken = token;
        _verifiedPhone = phone;
      });
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final token = _verifyToken;
    final phone = _verifiedPhone;
    if (token == null || phone == null) return;
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    try {
      await context
          .read<AppState>()
          .resetPassword(phone, token, _password.text);
      // Signed in — drop back to the root, which now shows the home screen.
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
        // An expired verification token needs a fresh code.
        if (e.status == 401) {
          setState(() {
            _verifyToken = null;
            _verifiedPhone = null;
          });
        }
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Passwort vergessen')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.lock_reset_rounded,
                        size: 72, color: scheme.primary),
                    const SizedBox(height: 18),
                    Text(
                      _verified
                          ? 'Neues Passwort wählen'
                          : 'Wir setzen dein Passwort zurück',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _verified
                          ? 'Deine Nummer ist bestätigt. Leg jetzt ein neues '
                              'Passwort fest — danach bist du direkt angemeldet.'
                          : 'Gib die Handynummer deines Kontos ein. Wir '
                              'schicken dir einen Code per SMS, mit dem du ein '
                              'neues Passwort festlegen kannst.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 26),
                    if (!_verified) ...[
                      TextField(
                        controller: _phone,
                        autofocus: true,
                        keyboardType: TextInputType.phone,
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
                        ],
                        decoration: const InputDecoration(
                          labelText: 'Handynummer',
                          hintText: '+43 660 1234567',
                          prefixIcon: Icon(Icons.phone_rounded),
                        ),
                        onSubmitted: (_) => _startVerification(),
                      ),
                      const SizedBox(height: 18),
                      FilledButton.icon(
                        onPressed: _busy ? null : _startVerification,
                        icon: const Icon(Icons.sms_rounded),
                        label: const Text('Code anfordern'),
                      ),
                    ] else ...[
                      TextFormField(
                        controller: _password,
                        autofocus: true,
                        obscureText: !_showPassword,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Neues Passwort',
                          prefixIcon: const Icon(Icons.lock_rounded),
                          suffixIcon: IconButton(
                            icon: Icon(_showPassword
                                ? Icons.visibility_off_rounded
                                : Icons.visibility_rounded),
                            onPressed: () =>
                                setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        validator: (v) =>
                            (v ?? '').length < 6 ? 'Mindestens 6 Zeichen.' : null,
                      ),
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2.4, color: Colors.white),
                              )
                            : const Text('Passwort speichern'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
