import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/app_state.dart';

/// Show a polished bottom sheet for inviting someone to Ping via WhatsApp,
/// Telegram, SMS, e-mail — or by copying the link/message (for Signal, Discord,
/// Instagram, …). Pass [phone] to pre-address WhatsApp/SMS to a known contact.
Future<void> showInviteSheet(BuildContext context, {String? phone, String? name}) {
  final link = _inviteLink(context);
  final who = (name != null && name.trim().isNotEmpty) ? '${name.split(' ').first}, ' : '';
  final message =
      'Hey ${who.isEmpty ? '' : who}ich bin auf Ping – ein schneller, moderner Messenger. '
      'Lad ihn dir und schreib mir: $link';

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (ctx) => _InviteSheet(phone: phone, link: link, message: message),
  );
}

String _inviteLink(BuildContext context) {
  final base = context.read<AppState>().baseUrl.trim();
  final clean = base.replaceAll(RegExp(r'/$'), '');
  return clean.startsWith('http') ? clean : 'https://example.invalid';
}

class _InviteSheet extends StatelessWidget {
  final String? phone;
  final String link;
  final String message;
  const _InviteSheet({this.phone, required this.link, required this.message});

  static String _digits(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

  Future<void> _launch(BuildContext context, Uri uri, {String? fallbackCopy}) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('no handler');
      if (context.mounted) Navigator.of(context).maybePop();
    } catch (_) {
      if (!context.mounted) return;
      if (fallbackCopy != null) {
        await Clipboard.setData(ClipboardData(text: fallbackCopy));
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('App nicht gefunden — Einladung kopiert.')));
        }
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Diese App konnte nicht geöffnet werden.')));
      }
    }
  }

  Future<void> _copy(BuildContext context, String text, String toast) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(toast)));
      Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enc = Uri.encodeComponent(message);
    final encLink = Uri.encodeComponent(link);
    final waBase = phone != null && _digits(phone!).isNotEmpty
        ? 'https://wa.me/${_digits(phone!)}?text=$enc'
        : 'https://wa.me/?text=$enc';

    final tiles = <Widget>[
      _InviteOption(
        color: const Color(0xFF25D366),
        icon: Icons.chat_rounded,
        label: 'WhatsApp',
        onTap: () => _launch(context, Uri.parse(waBase), fallbackCopy: message),
      ),
      _InviteOption(
        color: const Color(0xFF0088CC),
        icon: Icons.send_rounded,
        label: 'Telegram',
        onTap: () => _launch(
          context,
          Uri.parse('https://t.me/share/url?url=$encLink&text=$enc'),
          fallbackCopy: message,
        ),
      ),
      _InviteOption(
        color: const Color(0xFF34B7F1),
        icon: Icons.sms_rounded,
        label: 'SMS',
        onTap: () => _launch(
          context,
          Uri(
            scheme: 'sms',
            path: phone != null ? _digits(phone!) : '',
            queryParameters: {'body': message},
          ),
          fallbackCopy: message,
        ),
      ),
      _InviteOption(
        color: const Color(0xFFEA4335),
        icon: Icons.mail_rounded,
        label: 'E-Mail',
        onTap: () => _launch(
          context,
          Uri(
            scheme: 'mailto',
            queryParameters: {
              'subject': 'Komm zu Ping',
              'body': message,
            },
          ),
          fallbackCopy: message,
        ),
      ),
      _InviteOption(
        color: const Color(0xFF5865F2),
        icon: Icons.copy_rounded,
        label: 'Text kopieren',
        onTap: () => _copy(context, message, 'Einladungstext kopiert.'),
      ),
      _InviteOption(
        color: scheme.primary,
        icon: Icons.link_rounded,
        label: 'Link kopieren',
        onTap: () => _copy(context, link, 'Link kopiert.'),
      ),
    ];

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Freunde zu Ping einladen',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              'Teile deinen Einladungslink über deine Lieblings-App.',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 14,
              crossAxisSpacing: 14,
              childAspectRatio: 0.92,
              children: tiles,
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Icon(Icons.link_rounded, size: 18, color: scheme.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(link,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  TextButton(
                    onPressed: () => _copy(context, link, 'Link kopiert.'),
                    child: const Text('Kopieren'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InviteOption extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _InviteOption({
    required this.color,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Icon(icon, color: color, size: 26),
          ),
          const SizedBox(height: 8),
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        ],
      ),
    );
  }
}
