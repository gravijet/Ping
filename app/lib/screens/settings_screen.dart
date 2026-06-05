import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../widgets/avatar.dart';
import 'profile_edit_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final me = state.me;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Einstellungen')),
      body: ListView(
        children: [
          if (me != null)
            InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ProfileEditScreen()),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                child: Row(
                  children: [
                    PingAvatar(
                      initials: me.initials,
                      color: me.color,
                      size: 64,
                      imageUrl: state.avatarUrl(me),
                      imageHeaders: state.authHeaders,
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(me.label,
                              style:
                                  Theme.of(context).textTheme.titleLarge),
                          Text(me.phone,
                              style: TextStyle(color: scheme.onSurfaceVariant)),
                          if (me.about.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                me.about,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    color: scheme.onSurfaceVariant,
                                    fontSize: 13),
                              ),
                            ),
                        ],
                      ),
                    ),
                    Icon(Icons.edit_outlined, color: scheme.primary),
                  ],
                ),
              ),
            ),
          const Divider(),
          _SectionHeader('Darstellung'),
          _ThemeSelector(state: state),
          const Divider(),
          _SectionHeader('Verbindung'),
          ListTile(
            leading: Icon(
              state.socketConnected
                  ? Icons.cloud_done_rounded
                  : Icons.cloud_off_rounded,
              color: state.socketConnected ? const Color(0xFF22C55E) : scheme.error,
            ),
            title: const Text('Server'),
            subtitle: Text(
                '${state.baseUrl}\n${state.socketConnected ? 'Verbunden' : 'Nicht verbunden'}'),
            isThreeLine: true,
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => _editServer(context, state),
          ),
          const Divider(),
          _SectionHeader('Über'),
          const ListTile(
            leading: Icon(Icons.bolt_rounded),
            title: Text('Ping'),
            subtitle: Text('Version 1.0.0 — schnell, bunt, einfach.'),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                foregroundColor: scheme.error,
                side: BorderSide(color: scheme.error.withValues(alpha: 0.5)),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
              ),
              icon: const Icon(Icons.logout_rounded),
              label: const Text('Abmelden'),
              onPressed: () => _confirmLogout(context, state),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, AppState state) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Abmelden?'),
        content: const Text(
            'Du wirst von diesem Gerät abgemeldet. Deine Chats bleiben '
            'erhalten und sind nach der nächsten Anmeldung wieder da.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Abmelden'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await state.logout();
      if (context.mounted) Navigator.of(context).pop();
    }
  }

  Future<void> _editServer(BuildContext context, AppState state) async {
    final controller = TextEditingController(text: state.baseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server-Adresse'),
        content: TextField(
          controller: controller,
          autocorrect: false,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'URL',
            hintText: defaultBaseUrl,
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Abbrechen')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Speichern'),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty) {
      await state.setBaseUrl(result);
    }
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _ThemeSelector extends StatelessWidget {
  final AppState state;
  const _ThemeSelector({required this.state});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: SegmentedButton<ThemeMode>(
        segments: const [
          ButtonSegment(
              value: ThemeMode.system,
              icon: Icon(Icons.brightness_auto_rounded),
              label: Text('System')),
          ButtonSegment(
              value: ThemeMode.light,
              icon: Icon(Icons.light_mode_rounded),
              label: Text('Hell')),
          ButtonSegment(
              value: ThemeMode.dark,
              icon: Icon(Icons.dark_mode_rounded),
              label: Text('Dunkel')),
        ],
        selected: {state.themeMode},
        onSelectionChanged: (s) => state.setThemeMode(s.first),
      ),
    );
  }
}
