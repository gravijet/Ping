import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// Add or change the optional backup email + password used for password login.
class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  late final TextEditingController _email;
  final _password = TextEditingController();
  final _current = TextEditingController();
  bool _saving = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: context.read<AppState>().me?.email ?? '');
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _current.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final state = context.read<AppState>();
    final me = state.me!;
    final email = _email.text.trim();
    final password = _password.text;

    final emailChanged = email.isNotEmpty && email != (me.email ?? '');
    final settingPassword = password.isNotEmpty;

    if (!emailChanged && !settingPassword) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nichts zu speichern.')),
      );
      return;
    }
    if (settingPassword && password.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Das Passwort braucht mindestens 6 Zeichen.')),
      );
      return;
    }
    if (settingPassword && me.hasPassword && _current.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bitte gib dein aktuelles Passwort ein.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      await state.setSecurity(
        email: emailChanged ? email : null,
        password: settingPassword ? password : null,
        currentPassword:
            settingPassword && me.hasPassword ? _current.text : null,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sicherung gespeichert.')),
        );
        Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AppState>().me!;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sicherung & Login'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2))
                : const Text('Speichern'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Icon(Icons.shield_outlined, color: scheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Optional: Hinterleg eine E-Mail und ein Passwort. Damit '
                    'kommst du auch dann rein, wenn du keinen SMS-Code '
                    'empfangen kannst.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            enableSuggestions: false,
            decoration: const InputDecoration(
              labelText: 'E-Mail (Backup)',
              hintText: 'user@example.invalid',
              prefixIcon: Icon(Icons.mail_outline_rounded),
            ),
          ),
          const SizedBox(height: 16),
          if (me.hasPassword) ...[
            TextField(
              controller: _current,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Aktuelles Passwort',
                prefixIcon: Icon(Icons.lock_clock_outlined),
              ),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _password,
            obscureText: _obscure,
            decoration: InputDecoration(
              labelText: me.hasPassword ? 'Neues Passwort' : 'Passwort (Backup)',
              hintText: 'mindestens 6 Zeichen',
              prefixIcon: const Icon(Icons.lock_outline_rounded),
              suffixIcon: IconButton(
                icon: Icon(_obscure
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (me.hasPassword)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                'Lass die Passwortfelder leer, um nur die E-Mail zu ändern.',
                style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
              ),
            ),
        ],
      ),
    );
  }
}
