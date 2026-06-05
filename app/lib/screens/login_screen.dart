import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';

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
        await state.register(
          _phone.text.trim(),
          _email.text.trim(),
          _password.text,
          _name.text.trim(),
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
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _header(scheme),
                    const SizedBox(height: 32),
                    _modeToggle(scheme),
                    const SizedBox(height: 24),
                    if (_register) ..._registerFields() else ..._loginFields(),
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
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: _busy ? null : _editServer,
                      icon: const Icon(Icons.dns_outlined, size: 18),
                      label: const Text('Server-Adresse'),
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
          'Ländervorwahl behandeln wir als deutsche Nummer (+49). Wir '
          'verschicken keinen Bestätigungscode.',
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
          hintText: '+49 170 1234567',
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
          width: 76,
          height: 76,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [PingTheme.seed, PingTheme.accent],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 44),
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
              'Adresse deines Ping-Servers. Standard ist der öffentliche Ping-'
              'Server. Für einen eigenen Server trag hier dessen Adresse ein.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autocorrect: false,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'URL',
                hintText: defaultBaseUrl,
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
