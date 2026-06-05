import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import 'chat_screen.dart';
import 'contact_picker_screen.dart';
import 'new_group_screen.dart';

/// Starting point for a new conversation: pick from your contacts that are on
/// Ping, type a number/email directly, or create a group.
class NewChatScreen extends StatelessWidget {
  const NewChatScreen({super.key});

  Future<void> _openChat(BuildContext context, Future<Chat> Function() open) async {
    try {
      final chat = await open();
      if (!context.mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => ChatScreen(chatId: chat.id)),
      );
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _fromContacts(BuildContext context) async {
    final user = await Navigator.of(context).push<PingUser>(
      MaterialPageRoute(
        builder: (_) => const ContactPickerScreen(title: 'Chat starten'),
      ),
    );
    if (user == null || !context.mounted) return;
    final state = context.read<AppState>();
    await _openChat(context, () => state.openDirectChat(user));
  }

  Future<void> _byIdentifier(BuildContext context) async {
    final result = await showDialog<_Identifier>(
      context: context,
      builder: (_) => const _IdentifierDialog(),
    );
    if (result == null || !context.mounted) return;
    final state = context.read<AppState>();
    await _openChat(
      context,
      () => state.startDirectByIdentifier(
        phone: result.isEmail ? null : result.value,
        email: result.isEmail ? result.value : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Neuer Chat')),
      body: ListView(
        children: [
          _tile(
            scheme,
            Icons.contacts_rounded,
            'Aus Kontakten wählen',
            'Sieh, wer aus deinem Adressbuch schon bei Ping ist',
            () => _fromContacts(context),
          ),
          _tile(
            scheme,
            Icons.dialpad_rounded,
            'Per Nummer oder E-Mail',
            'Direkt eine Handynummer oder E-Mail eingeben',
            () => _byIdentifier(context),
          ),
          _tile(
            scheme,
            Icons.group_add_rounded,
            'Neue Gruppe',
            'Mehrere Leute in einem Chat',
            () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (_) => const NewGroupScreen()),
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                Icon(Icons.lock_rounded,
                    size: 16, color: scheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Datenschutz: Dein Adressbuch wird nur zum Abgleich genutzt '
                    'und nie auf dem Server gespeichert. Andere können dich nicht '
                    'über eine Namenssuche finden.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(ColorScheme scheme, IconData icon, String title, String subtitle,
      VoidCallback onTap) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      leading: CircleAvatar(
        backgroundColor: scheme.primaryContainer,
        child: Icon(icon, color: scheme.onPrimaryContainer),
      ),
      title:
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle),
      onTap: onTap,
    );
  }
}

/// The result of the manual-entry dialog: a raw value plus whether it's an email
/// (vs. a phone number), so the caller knows which API field to fill.
class _Identifier {
  final String value;
  final bool isEmail;
  const _Identifier(this.value, this.isEmail);
}

class _IdentifierDialog extends StatefulWidget {
  const _IdentifierDialog();

  @override
  State<_IdentifierDialog> createState() => _IdentifierDialogState();
}

class _IdentifierDialogState extends State<_IdentifierDialog> {
  final _controller = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    final raw = _controller.text.trim();
    Navigator.of(context).pop(_Identifier(raw, raw.contains('@')));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Per Nummer oder E-Mail'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Gib eine Handynummer oder E-Mail ein. Die Person muss schon '
                'bei Ping registriert sein.'),
            const SizedBox(height: 16),
            TextFormField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              onFieldSubmitted: (_) => _submit(),
              decoration: const InputDecoration(
                labelText: 'Nummer oder E-Mail',
                hintText: '+49 170 1234567',
                prefixIcon: Icon(Icons.alternate_email_rounded),
              ),
              validator: (v) => (v ?? '').trim().isEmpty
                  ? 'Bitte gib eine Nummer oder E-Mail ein.'
                  : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Abbrechen'),
        ),
        FilledButton(
          onPressed: _submit,
          child: const Text('Chat starten'),
        ),
      ],
    );
  }
}
