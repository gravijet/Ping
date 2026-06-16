import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../platform.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';
import '../widgets/ping_logo.dart';
import 'forgot_password_screen.dart';
import 'link_device_screen.dart';
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
  // On the Windows desktop build the primary path is linking via QR; the
  // password form is a fallback the user can switch to.
  bool _useQrLink = isDesktopPlatform;

  @override
  void initState() {
    super.initState();
    // Desktop can't register (no SMS phone verification) — start on sign-in.
    if (isDesktopPlatform) _register = false;
  }

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
                      child: (isDesktopPlatform && _useQrLink)
                          ? _DesktopLinkPanel(
                              onUsePassword: () =>
                                  setState(() => _useQrLink = false),
                              onEditServer: _busy ? null : _editServer,
                            )
                          : Form(
                              key: _formKey,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  // No registration on desktop — only the toggle
                                  // on mobile, where phone verification works.
                                  if (!isDesktopPlatform) ...[
                                    _modeToggle(scheme),
                                    const SizedBox(height: 22),
                                  ],
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
                                                strokeWidth: 2.4,
                                                color: Colors.white),
                                          )
                                        : Text(_register
                                            ? 'Konto erstellen'
                                            : 'Anmelden'),
                                  ),
                                  if (isDesktopPlatform)
                                    TextButton.icon(
                                      onPressed: _busy
                                          ? null
                                          : () => setState(
                                              () => _useQrLink = true),
                                      icon: const Icon(
                                          Icons.qr_code_rounded, size: 18),
                                      label: const Text('Mit QR-Code verknüpfen'),
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

/// Desktop sign-in via a QR code, WhatsApp-Web style: we ask the server for a
/// pending link, render its code as a QR for the phone to scan, and poll until
/// the phone approves it — at which point [AppState.pollDeviceLink] signs us in
/// and the root widget swaps to the home screen. Expired codes auto-refresh.
class _DesktopLinkPanel extends StatefulWidget {
  const _DesktopLinkPanel({required this.onUsePassword, this.onEditServer});

  final VoidCallback onUsePassword;
  final VoidCallback? onEditServer;

  @override
  State<_DesktopLinkPanel> createState() => _DesktopLinkPanelState();
}

class _DesktopLinkPanelState extends State<_DesktopLinkPanel> {
  String? _code;
  String? _linkId;
  String? _pollSecret;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _begin();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _begin() async {
    setState(() {
      _error = null;
      _code = null;
    });
    try {
      final link = await context.read<AppState>().startDeviceLink();
      if (!mounted) return;
      setState(() {
        _code = link['code'] as String?;
        _linkId = link['linkId'] as String?;
        _pollSecret = link['pollSecret'] as String?;
      });
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 2), (_) => _tick());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _tick() async {
    final linkId = _linkId, secret = _pollSecret;
    if (linkId == null || secret == null) return;
    try {
      // On success this signs us in; the root widget replaces this screen.
      await context.read<AppState>().pollDeviceLink(linkId, secret);
    } on ApiException {
      // The code expired before anyone scanned it — start a fresh one.
      _poll?.cancel();
      if (mounted) _begin();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Mit dem Handy verknüpfen',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 6),
        Text(
          'Öffne Ping auf deinem Handy → Einstellungen → „Ping für Windows" und '
          'scanne diesen Code.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
        ),
        const SizedBox(height: 20),
        Center(child: _qr(scheme)),
        const SizedBox(height: 20),
        TextButton.icon(
          onPressed: widget.onUsePassword,
          icon: const Icon(Icons.password_rounded, size: 18),
          label: const Text('Stattdessen mit Passwort anmelden'),
        ),
        if (widget.onEditServer != null)
          TextButton.icon(
            onPressed: widget.onEditServer,
            icon: const Icon(Icons.dns_outlined, size: 18),
            label: const Text('Server-Adresse'),
          ),
      ],
    );
  }

  Widget _qr(ColorScheme scheme) {
    const size = 220.0;
    if (_error != null) {
      return SizedBox(
        width: size,
        height: size,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.wifi_off_rounded, color: scheme.error, size: 40),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.tonal(
              onPressed: _begin,
              child: const Text('Erneut versuchen'),
            ),
          ],
        ),
      );
    }
    final code = _code;
    if (code == null) {
      return const SizedBox(
        width: size,
        height: size,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    // QR codes scan most reliably on a white field, regardless of app theme.
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: QrImageView(
        data: '$kLinkQrPrefix$code',
        size: size,
        backgroundColor: Colors.white,
        eyeStyle: const QrEyeStyle(
          eyeShape: QrEyeShape.square,
          color: Colors.black,
        ),
        dataModuleStyle: const QrDataModuleStyle(
          dataModuleShape: QrDataModuleShape.square,
          color: Colors.black,
        ),
      ),
    );
  }
}
