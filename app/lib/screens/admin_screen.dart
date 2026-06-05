import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

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
    });
    try {
      final stats = await _api.get('/admin/stats');
      final users = await _api.get('/admin/users', {if (_query.isNotEmpty) 'q': _query});
      if (!mounted) return;
      setState(() {
        _stats = (stats as Map).cast<String, dynamic>();
        _users = users['users'] as List;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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
          IconButton(
            tooltip: 'Durchsage',
            icon: const Icon(Icons.campaign_rounded),
            onPressed: _broadcast,
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
    final online = u['online'] == true;
    return ListTile(
      title: Row(
        children: [
          Flexible(child: Text('${u['displayName']}')),
          if (isAdmin)
            Container(
              margin: const EdgeInsets.only(left: 8),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text('Admin', style: TextStyle(fontSize: 11)),
            ),
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
          const PopupMenuItem(value: 'pw', child: Text('Passwort ändern')),
          const PopupMenuItem(value: 'del', child: Text('Löschen')),
        ],
      ),
    );
  }
}
