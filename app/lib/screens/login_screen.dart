import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';
import '../widgets/ping_logo.dart';
import 'forgot_password_screen.dart';
import 'phone_verify_screen.dart';

/// The entry screen. Two modes:
///  - Register: name, phone, email and password (all required, no verification).
///  - Login: phone or email + password.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _login = TextEditingController(); // phone-or-email for sign-in

  bool _register = true; // start on the registration form
  bool _busy = false;
  bool _showPassword = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _password.dispose();
    _login.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    final state = context.read<AppState>();
    try {
      if (_register) {
        final phoneRaw = _phone.text.trim();
        String? verifyToken;
        // On mobile we prove phone ownership via an SMS code before creating the
        // account. The server texts the code (or returns it in test mode).
        if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
          verifyToken = await Navigator.of(context).push<String>(
            MaterialPageRoute(
              builder: (_) => PhoneVerifyScreen(phone: phoneRaw),
            ),
          );
          if (verifyToken == null) {
            // Verification was cancelled or failed — don't create the account.
            if (mounted) setState(() => _busy = false);
            return;
          }
        }
        await state.register(
          phoneRaw,
          _email.text.trim(),
          _password.text,
          _name.text.trim(),
          verifyToken: verifyToken,
        );
      } else {
        await state.login(_login.text.trim(), _password.text);
      }
      // On success the root widget swaps to the home screen automatically.
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
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color.lerp(scheme.surface, context.ping.brand, 0.22) ?? scheme.surface,
              scheme.surface,
            ],
            stops: const [0, 0.55],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _header(scheme),
                    const SizedBox(height: 26),
                    Container(
                      padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(26),
                        border: Border.all(
                            color: scheme.outlineVariant.withValues(alpha: 0.4)),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.10),
                            blurRadius: 34,
                            offset: const Offset(0, 16),
                          ),
                        ],
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _modeToggle(scheme),
                            const SizedBox(height: 22),
                            if (_register)
                              ..._registerFields()
                            else
                              ..._loginFields(),
                            const SizedBox(height: 22),
                            FilledButton(
                              onPressed: _busy ? null : _submit,
                              child: _busy
                                  ? const SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2.4, color: Colors.white),
                                    )
                                  : Text(_register ? 'Konto erstellen' : 'Anmelden'),
                            ),
                            const SizedBox(height: 4),
                            TextButton.icon(
                              onPressed: _busy ? null : _editServer,
                              icon: const Icon(Icons.dns_outlined, size: 18),
                              label: const Text('Server-Adresse'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Form fields ---------------------------------------------------------

  List<Widget> _registerFields() => [
        TextFormField(
          controller: _name,
          textInputAction: TextInputAction.next,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            labelText: 'Name',
            hintText: 'Wie du angezeigt wirst',
            prefixIcon: Icon(Icons.person_rounded),
          ),
          validator: (v) => (v ?? '').trim().isEmpty
              ? 'Bitte gib einen Namen ein.'
              : null,
        ),
        const SizedBox(height: 14),
        _phoneField(),
        const SizedBox(height: 14),
        _emailField(),
        const SizedBox(height: 14),
        _passwordField(),
        const SizedBox(height: 10),
        _hint(
          'Telefonnummer, E-Mail und Passwort sind nötig. Nummern ohne '
          'Ländervorwahl behandeln wir als österreichische Nummer (+43). Mit '
          '+<Vorwahl> kannst du das überschreiben.',
        ),
      ];

  List<Widget> _loginFields() => [
        TextFormField(
          controller: _login,
          autofocus: true,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'Handynummer oder E-Mail',
            prefixIcon: Icon(Icons.alternate_email_rounded),
          ),
          validator: (v) => (v ?? '').trim().isEmpty
              ? 'Bitte gib deine Nummer oder E-Mail ein.'
              : null,
        ),
        const SizedBox(height: 14),
        _passwordField(),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: _busy
                ? null
                : () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => const ForgotPasswordScreen())),
            child: const Text('Passwort vergessen?'),
          ),
        ),
      ];

  Widget _phoneField() => TextFormField(
        controller: _phone,
        keyboardType: TextInputType.phone,
        textInputAction: TextInputAction.next,
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
        ],
        decoration: const InputDecoration(
          labelText: 'Handynummer',
          hintText: '+43 660 1234567',
          prefixIcon: Icon(Icons.phone_rounded),
        ),
        validator: (v) {
          final digits = (v ?? '').replaceAll(RegExp(r'[^0-9]'), '');
          if (digits.length < 5) {
            return 'Bitte gib eine gültige Handynummer ein.';
          }
          return null;
        },
      );

  Widget _emailField() => TextFormField(
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: 'E-Mail',
          hintText: 'user@example.invalid',
          prefixIcon: Icon(Icons.mail_rounded),
        ),
        validator: (v) {
          final s = (v ?? '').trim();
          if (!s.contains('@') || !s.contains('.')) {
            return 'Bitte gib eine gültige E-Mail-Adresse ein.';
          }
          return null;
        },
      );

  Widget _passwordField() => TextFormField(
        controller: _password,
        obscureText: !_showPassword,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          labelText: 'Passwort',
          prefixIcon: const Icon(Icons.lock_rounded),
          suffixIcon: IconButton(
            icon: Icon(_showPassword
                ? Icons.visibility_off_rounded
                : Icons.visibility_rounded),
            onPressed: () => setState(() => _showPassword = !_showPassword),
          ),
        ),
        validator: (v) {
          if ((v ?? '').length < 6) {
            return 'Mindestens 6 Zeichen.';
          }
          return null;
        },
      );

  // ---- Chrome --------------------------------------------------------------

  Widget _modeToggle(ColorScheme scheme) {
    return SegmentedButton<bool>(
      segments: const [
        ButtonSegment(value: true, label: Text('Registrieren')),
        ButtonSegment(value: false, label: Text('Anmelden')),
      ],
      selected: {_register},
      onSelectionChanged: _busy
          ? null
          : (s) => setState(() {
                _register = s.first;
                _formKey.currentState?.reset();
              }),
    );
  }

  Widget _hint(String text) => Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
      );

  Widget _header(ColorScheme scheme) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [context.ping.brand, scheme.secondary],
            ),
            boxShadow: [
              BoxShadow(
                color: context.ping.brand.withValues(alpha: 0.45),
                blurRadius: 30,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: const PingLogo(size: 56, tile: false, glyphColor: Colors.white),
        ),
        const SizedBox(height: 18),
        Text(
          'Willkommen bei Ping',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 6),
        Text(
          'Registriere dich mit Handynummer, E-Mail und Passwort — '
          'und schreib deinen Leuten.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
        ),
      ],
    );
  }

  Future<void> _editServer() async {
    final state = context.read<AppState>();
    final controller = TextEditingController(text: state.baseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server-Adresse'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Standardmäßig nutzt die App den Ping-Standardserver. Für einen '
              'eigenen Server trag hier dessen Adresse ein.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autocorrect: false,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'URL',
                hintText: 'https://dein-server',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Abbrechen'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Speichern'),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty) {
      await state.setBaseUrl(result);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Server auf $result gesetzt.')),
        );
      }
    }
  }
}
