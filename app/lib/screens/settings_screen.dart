import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';
import '../widgets/ping_logo.dart';
import 'admin_screen.dart';
import 'profile_edit_screen.dart';
import 'security_screen.dart';
import 'settings_sections.dart';

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
                              style: Theme.of(context).textTheme.titleLarge),
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
          _navTile(context, Icons.chat_bubble_outline_rounded, 'Chats',
              'Schriftgröße, Hintergrund, Enter zum Senden',
              () => const ChatSettingsScreen()),
          const Divider(),
          _SectionHeader('Konto & Sicherheit'),
          _navTile(context, Icons.shield_outlined, 'Sicherung & Login',
              'E-Mail und Passwort ändern', () => const SecurityScreen()),
          _navTile(context, Icons.lock_outline_rounded, 'Datenschutz',
              'Lesebestätigungen, Online-Status, Blockierte',
              () => const PrivacySettingsScreen()),
          _navTile(
              context,
              Icons.notifications_none_rounded,
              'Benachrichtigungen',
              'Hinweise, Vorschau, Vibration',
              () => const NotificationSettingsScreen()),
          _navTile(context, Icons.record_voice_over_outlined, 'Vorlesen',
              'Text-to-Speech, Sprache, Geschwindigkeit',
              () => const ReadAloudSettingsScreen()),
          if (me?.isAdmin == true) ...[
            const Divider(),
            _SectionHeader('Verwaltung'),
            ListTile(
              leading: Icon(Icons.admin_panel_settings_rounded,
                  color: scheme.primary),
              title: const Text('Admin-Panel'),
              subtitle: const Text('Statistik, Nutzer, Durchsagen'),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const AdminScreen())),
            ),
          ],
          const Divider(),
          _SectionHeader('Verbindung'),
          ListTile(
            leading: Icon(
              state.socketConnected
                  ? Icons.cloud_done_rounded
                  : Icons.cloud_off_rounded,
              color:
                  state.socketConnected ? const Color(0xFF22C55E) : scheme.error,
            ),
            title: const Text('Server'),
            subtitle: Text(
              '${isDefaultServer(state.baseUrl) ? serverLabel : state.baseUrl}'
              '\n${state.socketConnected ? 'Verbunden' : 'Nicht verbunden'}',
            ),
            isThreeLine: true,
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => _editServer(context, state),
          ),
          const Divider(),
          _SectionHeader('Über'),
          ListTile(
            leading: const PingLogo(size: 40),
            title: const Text('Ping'),
            subtitle: const Text('Version 2.0.0 — schnell, sicher, in Blau.'),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: const Text('Open-Source-Lizenzen'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => showLicensePage(
              context: context,
              applicationName: 'Ping',
              applicationVersion: '2.0.0',
            ),
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
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: TextButton.icon(
              style: TextButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                foregroundColor: scheme.error,
              ),
              icon: const Icon(Icons.delete_forever_rounded),
              label: const Text('Konto löschen'),
              onPressed: () => _confirmDeleteAccount(context, state),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _navTile(BuildContext context, IconData icon, String title,
      String subtitle, Widget Function() builder) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => builder())),
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

  Future<void> _confirmDeleteAccount(
      BuildContext context, AppState state) async {
    final scheme = Theme.of(context).colorScheme;
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Konto löschen?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Dein Konto und deine Mitgliedschaften werden dauerhaft '
                'entfernt — das lässt sich nicht rückgängig machen. Gib zur '
                'Bestätigung dein Passwort ein.'),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Passwort',
                prefixIcon: Icon(Icons.lock_outline_rounded),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: scheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Endgültig löschen'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final password = controller.text;
    if (password.isEmpty) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Bitte gib dein Passwort ein.')),
        );
      }
      return;
    }
    try {
      await state.deleteAccount(password);
      if (context.mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
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
            hintText: 'https://dein-server',
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
