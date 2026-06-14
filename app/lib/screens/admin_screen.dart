import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/verified_badge.dart';
import 'status_tab.dart';

/// In-app admin panel, available to accounts with the admin flag. Talks to the
/// same /api/admin/* endpoints as the web portal, authorised by the user's JWT.
class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key});

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  Map<String, dynamic>? _stats;
  List<dynamic> _users = [];
  String _query = '';
  bool _loading = true;
  String? _error;
  // True when /api/admin is gated by Cloudflare Access (the native client can't
  // carry that browser login) — we then offer to open the web portal instead.
  bool _cloudflareBlocked = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  ApiClient get _api => context.read<AppState>().api;

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
      _cloudflareBlocked = false;
    });
    try {
      final stats = await _api.get('/admin/stats');
      // A non-JSON answer means something (usually a Cloudflare Access page)
      // sits in front of /api/admin and intercepted the request.
      if (stats is! Map) {
        if (mounted) setState(() => _cloudflareBlocked = true);
        return;
      }
      final users = await _api.get('/admin/users', {if (_query.isNotEmpty) 'q': _query});
      if (!mounted) return;
      setState(() {
        _stats = stats.cast<String, dynamic>();
        _users = (users is Map ? users['users'] : null) as List? ?? const [];
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (_isCloudflareBlock(e)) {
        setState(() => _cloudflareBlocked = true);
      } else {
        setState(() => _error = e.message);
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Konnte das Admin-Panel nicht laden.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Whether an error came from the Cloudflare Access gate in front of admin.
  bool _isCloudflareBlock(ApiException e) {
    final m = e.message.toLowerCase();
    return m.contains('cloudflare') || (e.status == 403 && m.contains('access'));
  }

  /// Open the web admin portal in the browser, where the Cloudflare Access
  /// login works. The user signs in there and can return to the app any time.
  Future<void> _openWebPortal() async {
    final base = context.read<AppState>().baseUrl;
    final root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    final ok = await launchUrl(
      Uri.parse('$root/admin'),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && mounted) _toast('Konnte den Browser nicht öffnen.');
  }

  Future<void> _reload() async {
    try {
      final users =
          await _api.get('/admin/users', {if (_query.isNotEmpty) 'q': _query});
      if (mounted) setState(() => _users = users['users'] as List);
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  Future<void> _toggleAdmin(Map u) async {
    try {
      await _api.patch('/admin/users/${u['id']}', {'isAdmin': !(u['isAdmin'] as bool)});
      await _refresh();
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _toggleBan(Map u) async {
    final disabled = u['disabled'] == true;
    try {
      await _api.patch('/admin/users/${u['id']}', {'disabled': !disabled});
      _toast(disabled ? 'Konto entsperrt.' : 'Konto gesperrt — Sitzungen beendet.');
      await _refresh();
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _messageUser(Map u) async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Nachricht an ${u['displayName']}'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          autofocus: true,
          decoration: const InputDecoration(
              labelText: 'Nachricht',
              hintText: 'Landet als „Ping Team"-Chat (ohne Antwort)'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Senden')),
        ],
      ),
    );
    if (ok != true || controller.text.trim().isEmpty) return;
    try {
      // A real, persisted DM in the user's read-only "Ping Team" channel.
      await _api.post('/admin/users/${u['id']}/dm', {'body': controller.text.trim()});
      _toast('Nachricht gesendet.');
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  /// Send a private one-way message to every user (WhatsApp-style broadcast).
  Future<void> _broadcastDm() async {
    final body = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Private Nachricht an alle'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Jeder Nutzer bekommt die Nachricht in seinem „Ping Team"-Chat. '
              'Antworten sind nicht möglich.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: body,
              maxLines: 4,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Nachricht'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('An alle senden')),
        ],
      ),
    );
    if (ok != true || body.text.trim().isEmpty) return;
    try {
      final res =
          await _api.post('/admin/broadcast-dm', {'body': body.text.trim()});
      _toast('An ${res['delivered']} Nutzer privat gesendet.');
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  /// Post an official status ("story") — text, photo or video — that every user
  /// sees for 24 hours. Reuses the full-screen status composer in official mode.
  Future<void> _postStatus() async {
    await showAddStatusSheet(context, official: true);
  }

  Future<void> _togglePremium(Map u) async {
    final premium = u['premium'] == true;
    try {
      await _api.patch('/admin/users/${u['id']}', {'premium': !premium});
      _toast(premium ? 'Premium entzogen.' : 'Premium vergeben. ✨');
      await _refresh();
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _resetPassword(Map u) async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Passwort für ${u['displayName']}'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
              labelText: 'Neues Passwort', hintText: 'mind. 6 Zeichen'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Setzen')),
        ],
      ),
    );
    if (ok != true || controller.text.length < 6) return;
    try {
      await _api.patch('/admin/users/${u['id']}', {'password': controller.text});
      _toast('Passwort geändert.');
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _deleteUser(Map u) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nutzer löschen?'),
        content: Text('„${u['displayName']}" wird dauerhaft entfernt.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Löschen'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/admin/users/${u['id']}');
      _toast('Nutzer gelöscht.');
      await _refresh();
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _broadcast() async {
    final title = TextEditingController();
    final body = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Durchsage senden'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: title,
              decoration: const InputDecoration(labelText: 'Titel (optional)'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: body,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Nachricht'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Senden')),
        ],
      ),
    );
    if (ok != true || body.text.trim().isEmpty) return;
    try {
      final res = await _api.post('/admin/broadcast',
          {'title': title.text.trim(), 'body': body.text.trim()});
      _toast('An ${res['delivered']} Online-Nutzer gesendet.');
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Senden',
            icon: const Icon(Icons.send_rounded),
            onSelected: (v) {
              switch (v) {
                case 'announce':
                  _broadcast();
                case 'dm-all':
                  _broadcastDm();
                case 'status':
                  _postStatus();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'announce',
                child: ListTile(
                  leading: Icon(Icons.campaign_rounded),
                  title: Text('Durchsage'),
                  subtitle: Text('Banner an alle'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: 'dm-all',
                child: ListTile(
                  leading: Icon(Icons.forward_to_inbox_rounded),
                  title: Text('Private Nachricht an alle'),
                  subtitle: Text('Als „Ping Team"-Chat'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: 'status',
                child: ListTile(
                  leading: Icon(Icons.amp_stories_rounded),
                  title: Text('Status für alle'),
                  subtitle: Text('Erscheint im Status-Tab'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
          IconButton(
            tooltip: 'Aktualisieren',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _refresh,
          ),
        ],
      ),
      body: _loading && _stats == null
          ? const Center(child: CircularProgressIndicator())
          : _cloudflareBlocked && _stats == null
              ? _cloudflareGate()
              : _error != null && _stats == null
                  ? Center(child: Text(_error!))
                  : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    children: [
                      _statsGrid(),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        child: TextField(
                          decoration: const InputDecoration(
                            hintText: 'Nutzer suchen (Name, Nummer, E-Mail) …',
                            prefixIcon: Icon(Icons.search_rounded),
                          ),
                          onChanged: (v) {
                            _query = v.trim();
                            _reload();
                          },
                        ),
                      ),
                      for (final u in _users) _userTile(u as Map),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  /// Shown when Cloudflare Access guards the admin API: the panel can't load
  /// natively, so we send the admin to the web portal to sign in there.
  Widget _cloudflareGate() {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_outline_rounded, size: 56, color: scheme.primary),
            const SizedBox(height: 16),
            const Text('Über Cloudflare geschützt',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(
              'Das Admin-Dashboard ist über Cloudflare abgesichert und lässt '
              'sich in der App nicht direkt öffnen. Melde dich im Browser an '
              'und verwalte alles dort — mit „Zurück" kommst du wieder in die App.',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: _openWebPortal,
              icon: const Icon(Icons.open_in_browser_rounded),
              label: const Text('Im Browser anmelden'),
            ),
            const SizedBox(height: 6),
            TextButton(
              onPressed: _refresh,
              child: const Text('Erneut versuchen'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statsGrid() {
    final s = _stats ?? {};
    final items = <(String, String)>[
      ('Nutzer', '${s['users'] ?? '–'}'),
      ('Online', '${s['online'] ?? '–'}'),
      ('Admins', '${s['admins'] ?? '–'}'),
      ('Chats', '${s['chats'] ?? '–'}'),
      ('Gruppen', '${s['groups'] ?? '–'}'),
      ('Nachrichten', '${s['messages'] ?? '–'}'),
      ('Status aktiv', '${s['statuses'] ?? '–'}'),
    ];
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          for (final it in items)
            Container(
              width: 108,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(it.$2,
                      style: const TextStyle(
                          fontSize: 24, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(it.$1,
                      style: TextStyle(
                          fontSize: 12,
                          color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _userTile(Map u) {
    final isAdmin = u['isAdmin'] == true;
    final premium = u['premium'] == true;
    final online = u['online'] == true;
    final disabled = u['disabled'] == true;
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      title: Row(
        children: [
          Flexible(
            child: Text('${u['displayName']}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    decoration:
                        disabled ? TextDecoration.lineThrough : null)),
          ),
          if (isAdmin) ...[
            const SizedBox(width: 5),
            const PingBadge(kind: BadgeKind.verified, size: 15),
          ],
          if (premium) ...[
            const SizedBox(width: 5),
            const PingBadge(kind: BadgeKind.premium, size: 15),
          ],
          if (disabled) _chip('gesperrt', scheme.errorContainer),
        ],
      ),
      subtitle: Text('${u['phone']} · ${u['email']}'),
      leading: CircleAvatar(
        backgroundColor: online ? Colors.green : Colors.grey,
        radius: 6,
      ),
      trailing: PopupMenuButton<String>(
        onSelected: (v) {
          switch (v) {
            case 'admin':
              _toggleAdmin(u);
            case 'premium':
              _togglePremium(u);
            case 'ban':
              _toggleBan(u);
            case 'msg':
              _messageUser(u);
            case 'pw':
              _resetPassword(u);
            case 'del':
              _deleteUser(u);
          }
        },
        itemBuilder: (_) => [
          PopupMenuItem(
              value: 'admin',
              child: Text(isAdmin ? 'Admin entziehen' : 'Zum Admin machen')),
          PopupMenuItem(
              value: 'premium',
              child: Text(premium ? 'Premium entziehen' : 'Premium vergeben')),
          PopupMenuItem(
              value: 'ban',
              child: Text(disabled ? 'Entsperren' : 'Sperren')),
          const PopupMenuItem(value: 'msg', child: Text('Nachricht senden')),
          const PopupMenuItem(value: 'pw', child: Text('Passwort ändern')),
          const PopupMenuItem(value: 'del', child: Text('Löschen')),
        ],
      ),
    );
  }

  Widget _chip(String label, Color color) => Container(
        margin: const EdgeInsets.only(left: 8),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label, style: const TextStyle(fontSize: 11)),
      );
}
