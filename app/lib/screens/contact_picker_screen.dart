import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/contacts_service.dart';
import '../widgets/avatar.dart';
import '../widgets/invite_sheet.dart';

/// Reads the device address book, matches it against Ping (privacy-preserving:
/// nothing is stored server-side) and lets the user pick one — or several —
/// contacts that already have a Ping account.
///
/// In single mode tapping a contact pops with that [PingUser]. In multi mode the
/// user ticks several and confirms, popping with a `List<PingUser>`.
class ContactPickerScreen extends StatefulWidget {
  final bool multiSelect;
  final String title;

  /// Ids already in the chat/group, shown as disabled ("Schon dabei").
  final Set<String> excludeIds;

  /// When true, also list address-book contacts who are NOT on Ping yet, each
  /// with an "Einladen" (SMS) action. Only used in single-select mode.
  final bool allowInvite;

  const ContactPickerScreen({
    super.key,
    this.multiSelect = false,
    this.title = 'Kontakte',
    this.excludeIds = const {},
    this.allowInvite = false,
  });

  @override
  State<ContactPickerScreen> createState() => _ContactPickerScreenState();
}

class _ContactPickerScreenState extends State<ContactPickerScreen> {
  final _contacts = ContactsService();

  bool _loading = true;
  bool _denied = false;
  String? _error;
  List<ContactMatch> _matches = [];
  List<LocalContact> _inviteCandidates = [];
  final Set<String> _selected = {};
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _denied = false;
      _error = null;
    });
    try {
      final granted = await _contacts.requestPermission();
      if (!granted) {
        if (mounted) setState(() => _denied = true);
        return;
      }
      final local = await _contacts.loadContacts();
      // Gather every phone number across the address book and ask the server
      // which of them are on Ping. The raw list never leaves this request, and
      // people are matched by phone only — never by email.
      final phones = <String>{};
      for (final c in local) {
        phones.addAll(c.phones);
      }
      if (!mounted) return;
      final state = context.read<AppState>();
      final matches = await state.matchContacts(phones.toList());
      // Drop people who are already in the chat and de-dupe by user id.
      final seen = <String>{};
      final filtered = <ContactMatch>[];
      for (final m in matches) {
        if (widget.excludeIds.contains(m.user.id)) continue;
        if (!seen.add(m.user.id)) continue;
        filtered.add(m);
      }
      filtered.sort((a, b) => a.user.label.toLowerCase().compareTo(
            b.user.label.toLowerCase(),
          ));

      // Work out who is NOT on Ping yet (for the invite list). Compare on the
      // last 8 digits so different formattings of the same number still match.
      List<LocalContact> invites = [];
      if (widget.allowInvite && !widget.multiSelect) {
        final onPing = <String>{};
        for (final m in matches) {
          final d = _digits(m.phone ?? '');
          if (d.isNotEmpty) onPing.add(_tail(d));
        }
        for (final c in local) {
          if (c.phones.isEmpty) continue;
          final isOnPing = c.phones.any((p) {
            final d = _digits(p);
            return d.isNotEmpty && onPing.contains(_tail(d));
          });
          if (!isOnPing) invites.add(c);
        }
      }
      if (mounted) {
        setState(() {
          _matches = filtered;
          _inviteCandidates = invites;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Kontakte konnten nicht gelesen werden.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<ContactMatch> get _visible {
    if (_filter.isEmpty) return _matches;
    final q = _filter.toLowerCase();
    return _matches
        .where((m) => m.user.label.toLowerCase().contains(q))
        .toList();
  }

  List<LocalContact> get _visibleInvites {
    if (_filter.isEmpty) return _inviteCandidates;
    final q = _filter.toLowerCase();
    return _inviteCandidates
        .where((c) =>
            c.displayName.toLowerCase().contains(q) ||
            c.phones.any((p) => p.contains(q)))
        .toList();
  }

  static String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');
  static String _tail(String d) => d.length > 8 ? d.substring(d.length - 8) : d;

  void _invite(LocalContact c) {
    showInviteSheet(
      context,
      phone: c.phones.isNotEmpty ? c.phones.first : null,
      name: c.displayName,
    );
  }

  void _onTap(ContactMatch m) {
    if (widget.multiSelect) {
      setState(() {
        if (!_selected.remove(m.user.id)) _selected.add(m.user.id);
      });
    } else {
      Navigator.of(context).pop(m.user);
    }
  }

  void _confirm() {
    final chosen = _matches
        .where((m) => _selected.contains(m.user.id))
        .map((m) => m.user)
        .toList();
    Navigator.of(context).pop(chosen);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (widget.multiSelect && _selected.isNotEmpty)
            TextButton(
              onPressed: _confirm,
              child: Text('Fertig (${_selected.length})'),
            ),
        ],
      ),
      body: Column(
        children: [
          if (!_loading && _matches.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: TextField(
                onChanged: (v) => setState(() => _filter = v.trim()),
                decoration: const InputDecoration(
                  hintText: 'Kontakte filtern …',
                  prefixIcon: Icon(Icons.search_rounded),
                ),
              ),
            ),
          Expanded(child: _body(scheme)),
        ],
      ),
    );
  }

  Widget _body(ColorScheme scheme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_denied) {
      return _info(
        scheme,
        Icons.contacts_outlined,
        'Kein Zugriff auf Kontakte',
        'Ping braucht die Berechtigung, deine Kontakte zu lesen, um zu zeigen, '
            'wer davon schon bei Ping ist. Du kannst sie in den '
            'Android-Einstellungen erteilen.',
        action: FilledButton.tonal(
          onPressed: _load,
          child: const Text('Erneut versuchen'),
        ),
      );
    }
    if (_error != null) {
      return _info(
        scheme,
        Icons.error_outline_rounded,
        'Etwas ist schiefgelaufen',
        _error!,
        action: FilledButton.tonal(
          onPressed: _load,
          child: const Text('Erneut versuchen'),
        ),
      );
    }
    if (_matches.isEmpty && _inviteCandidates.isEmpty) {
      return _info(
        scheme,
        Icons.person_search_rounded,
        'Niemand aus deinen Kontakten ist hier',
        'Keiner deiner gespeicherten Kontakte hat (noch) ein Ping-Konto. '
            'Lade sie ein oder starte einen Chat direkt per Nummer.',
      );
    }
    final state = context.read<AppState>();
    final matches = _visible;
    final invites = widget.allowInvite ? _visibleInvites : const <LocalContact>[];

    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(
            children: [
              Icon(Icons.lock_rounded,
                  size: 14, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Dein Adressbuch wird nur lokal abgeglichen und nie gespeichert.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
              ),
            ],
          ),
        ),
        if (matches.isNotEmpty)
          _sectionHeader(scheme, 'Auf Ping (${matches.length})'),
        for (final m in matches) _matchTile(state, m),
        if (invites.isNotEmpty) ...[
          _sectionHeader(scheme, 'Zu Ping einladen (${invites.length})'),
          for (final c in invites) _inviteTile(scheme, c),
        ],
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _sectionHeader(ColorScheme scheme, String label) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
        child: Text(
          label,
          style: TextStyle(
            color: scheme.primary,
            fontWeight: FontWeight.w700,
            fontSize: 13,
          ),
        ),
      );

  Widget _matchTile(AppState state, ContactMatch m) {
    final u = m.user;
    final selected = _selected.contains(u.id);
    return ListTile(
      leading: PingAvatar(
        initials: u.initials,
        color: u.color,
        size: 46,
        online: u.online,
        imageUrl: state.avatarUrl(u),
        imageHeaders: state.authHeaders,
      ),
      title:
          Text(u.label, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(m.phone ?? 'Auf Ping'),
      trailing: widget.multiSelect
          ? Checkbox(value: selected, onChanged: (_) => _onTap(m))
          : const Icon(Icons.chevron_right_rounded),
      onTap: () => _onTap(m),
    );
  }

  Widget _inviteTile(ColorScheme scheme, LocalContact c) {
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: scheme.surfaceContainerHighest,
        child: Icon(Icons.person_outline_rounded,
            color: scheme.onSurfaceVariant),
      ),
      title: Text(c.displayName,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(c.phones.isNotEmpty ? c.phones.first : ''),
      trailing: OutlinedButton.icon(
        onPressed: () => _invite(c),
        icon: const Icon(Icons.person_add_alt_rounded, size: 16),
        label: const Text('Einladen'),
      ),
      onTap: () => _invite(c),
    );
  }

  Widget _info(ColorScheme scheme, IconData icon, String title, String body,
      {Widget? action}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 72, color: scheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text(title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (action != null) ...[
              const SizedBox(height: 20),
              action,
            ],
          ],
        ),
      ),
    );
  }
}
