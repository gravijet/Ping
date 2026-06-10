import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/chat.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/brand.dart';
import '../widgets/invite_sheet.dart';
import 'chat_screen.dart';
import 'contact_picker_screen.dart';
import 'debug_chat_screen.dart';
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
        builder: (_) => const ContactPickerScreen(
          title: 'Chat starten',
          allowInvite: true,
        ),
      ),
    );
    if (user == null || !context.mounted) return;
    final state = context.read<AppState>();
    await _openChat(context, () => state.openDirectChat(user));
  }

  Future<void> _selfChat(BuildContext context) async {
    final state = context.read<AppState>();
    await _openChat(context, () => state.openSelfChat());
  }

  Future<void> _byPhone(BuildContext context) async {
    final phone = await showDialog<String>(
      context: context,
      builder: (_) => const _PhoneDialog(),
    );
    if (phone == null || !context.mounted) return;
    // Hidden diagnostics console.
    if (phone.replaceAll(' ', '') == '*0111') {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const DebugChatScreen()),
      );
      return;
    }
    final state = context.read<AppState>();
    await _openChat(context, () => state.startDirectByPhone(phone));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: pingAppBar(context, title: const Text('Neuer Chat')),
      body: ListView(
        children: [
          _tile(
            scheme,
            Icons.bookmark_rounded,
            'Notiz an mich',
            'Nachrichten, Links und Dateien für dich selbst',
            () => _selfChat(context),
          ),
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
            'Per Telefonnummer',
            'Direkt eine Handynummer eingeben',
            () => _byPhone(context),
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
          _tile(
            scheme,
            Icons.person_add_alt_rounded,
            'Freunde einladen',
            'Per WhatsApp, Telegram, SMS oder Link',
            () => showInviteSheet(context),
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

class _PhoneDialog extends StatefulWidget {
  const _PhoneDialog();

  @override
  State<_PhoneDialog> createState() => _PhoneDialogState();
}

class _PhoneDialogState extends State<_PhoneDialog> {
  final _controller = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Per Telefonnummer'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Gib eine Handynummer ein. Die Person muss schon bei Ping '
                'registriert sein. Man findet andere nur über die Nummer.'),
            const SizedBox(height: 16),
            TextFormField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.phone,
              autocorrect: false,
              onFieldSubmitted: (_) => _submit(),
              decoration: const InputDecoration(
                labelText: 'Handynummer',
                hintText: '+43 660 1234567',
                prefixIcon: Icon(Icons.phone_rounded),
              ),
              validator: (v) => (v ?? '').trim().length < 4
                  ? 'Bitte gib eine Handynummer ein.'
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
