import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/settings.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../services/wallpaper_service.dart';
import '../widgets/avatar.dart';
import '../widgets/wallpaper_picker.dart';

// ---- Privacy ---------------------------------------------------------------

class PrivacySettingsScreen extends StatelessWidget {
  const PrivacySettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    void update(PingSettings next) => state.updateSettings(next);

    return Scaffold(
      appBar: AppBar(title: const Text('Datenschutz')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.done_all_rounded),
            title: const Text('Lesebestätigungen'),
            subtitle: const Text(
                'Wenn aus, sehen andere nicht, ob du ihre Nachrichten gelesen '
                'hast — und du ihre auch nicht.'),
            value: s.readReceipts,
            onChanged: (v) => update(s.copyWith(readReceipts: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.schedule_rounded),
            title: const Text('„Zuletzt online" zeigen'),
            subtitle: const Text(
                'Wenn aus, sehen andere nicht mehr, wann du zuletzt online '
                'warst. Ob du gerade online bist, bleibt sichtbar.'),
            value: state.me?.showLastSeen ?? true,
            onChanged: (v) async {
              try {
                await state.setShowLastSeen(v);
              } on ApiException catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context)
                      .showSnackBar(SnackBar(content: Text(e.message)));
                }
              }
            },
          ),
          const Divider(),
          SwitchListTile(
            secondary: const Icon(Icons.cloud_off_rounded),
            title: const Text('Nachrichten nur lokal speichern'),
            subtitle: Text(state.localStorageOnly
                ? 'Deine gesendeten Nachrichten werden vom Server gelöscht, '
                    'sobald alle sie gelesen haben. Nur dieses Gerät behält eine '
                    'Kopie — Verlauf auf neuen Geräten geht verloren.'
                : 'Nachrichten bleiben auf dem Server (Standard) und sind auf '
                    'allen deinen Geräten verfügbar.'),
            value: state.localStorageOnly,
            onChanged: (v) async {
              try {
                await state.setMessageStorage(v ? 'local' : 'server');
              } on ApiException catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context)
                      .showSnackBar(SnackBar(content: Text(e.message)));
                }
              }
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.block_rounded),
            title: const Text('Blockierte Kontakte'),
            subtitle: Text('${state.blockedIds.length} blockiert'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const BlockedContactsScreen())),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text(
              'Man findet dich nur über deine Telefonnummer — nie über eine '
              'Namens- oder E-Mail-Suche. Dein Adressbuch wird nie gespeichert.',
              style: TextStyle(fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}

class BlockedContactsScreen extends StatefulWidget {
  const BlockedContactsScreen({super.key});

  @override
  State<BlockedContactsScreen> createState() => _BlockedContactsScreenState();
}

class _BlockedContactsScreenState extends State<BlockedContactsScreen> {
  List<PingUser> _users = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final out = <PingUser>[];
    for (final id in state.blockedIds) {
      final u = await state.fetchUser(id);
      if (u != null) out.add(u);
    }
    if (mounted) {
      setState(() {
        _users = out;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    // Keep the visible list in sync with unblocks.
    final visible =
        _users.where((u) => state.blockedIds.contains(u.id)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Blockierte Kontakte')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : visible.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(40),
                    child: Text('Du hast niemanden blockiert.',
                        textAlign: TextAlign.center),
                  ),
                )
              : ListView(
                  children: [
                    for (final u in visible)
                      ListTile(
                        leading: PingAvatar(
                          initials: u.initials,
                          color: u.color,
                          size: 46,
                          imageUrl: state.avatarUrl(u),
                          imageHeaders: state.authHeaders,
                        ),
                        title: Text(u.label),
                        trailing: TextButton(
                          onPressed: () async {
                            try {
                              await state.unblockUser(u.id);
                            } on ApiException catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text(e.message)));
                              }
                            }
                          },
                          child: const Text('Entsperren'),
                        ),
                      ),
                  ],
                ),
    );
  }
}

// ---- Notifications ---------------------------------------------------------

class NotificationSettingsScreen extends StatelessWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    void update(PingSettings next) => state.updateSettings(next);

    return Scaffold(
      appBar: AppBar(title: const Text('Benachrichtigungen')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.notifications_active_rounded),
            title: const Text('Benachrichtigungen'),
            subtitle: const Text('Hinweise bei neuen Nachrichten anzeigen.'),
            value: s.notificationsEnabled,
            onChanged: (v) => update(s.copyWith(notificationsEnabled: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.notes_rounded),
            title: const Text('Vorschau anzeigen'),
            subtitle: const Text('Nachrichtentext in der Benachrichtigung.'),
            value: s.notificationPreview,
            onChanged: s.notificationsEnabled
                ? (v) => update(s.copyWith(notificationPreview: v))
                : null,
          ),
          SwitchListTile(
            secondary: const Icon(Icons.vibration_rounded),
            title: const Text('Vibrieren'),
            value: s.notificationVibrate,
            onChanged: s.notificationsEnabled
                ? (v) => update(s.copyWith(notificationVibrate: v))
                : null,
          ),
        ],
      ),
    );
  }
}

// ---- Chats -----------------------------------------------------------------

class ChatSettingsScreen extends StatelessWidget {
  const ChatSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    final scheme = Theme.of(context).colorScheme;
    void update(PingSettings next) => state.updateSettings(next);

    return Scaffold(
      appBar: AppBar(title: const Text('Chats')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.keyboard_return_rounded),
            title: const Text('Mit Enter senden'),
            subtitle: const Text('Die Eingabetaste verschickt die Nachricht.'),
            value: s.enterToSend,
            onChanged: (v) => update(s.copyWith(enterToSend: v)),
          ),
          const Divider(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
            child: Text('Schriftgröße',
                style: Theme.of(context).textTheme.titleSmall),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text('So sehen deine Nachrichten aus.',
                  style: TextStyle(fontSize: 15.5 * s.fontScale)),
            ),
          ),
          Slider(
            value: s.fontScale,
            min: 0.85,
            max: 1.4,
            divisions: 11,
            label: '${(s.fontScale * 100).round()}%',
            onChanged: (v) => update(s.copyWith(fontScale: v)),
          ),
          const Divider(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
            child: Text('Chat-Hintergrund',
                style: Theme.of(context).textTheme.titleSmall),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(
              'Gilt für alle Chats. Pro Chat lässt sich der Hintergrund in den '
              'Chat-Infos überschreiben. Bild, GIF oder Video möglich.',
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
            ),
          ),
          WallpaperPicker(
            current: WallpaperSpec.decode(s.wallpaperSpec),
            onPick: (spec) => state.setGlobalWallpaper(spec),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

// ---- Read aloud (TTS) ------------------------------------------------------

const _ttsLanguages = {
  'de-DE': 'Deutsch',
  'en-US': 'Englisch (US)',
  'en-GB': 'Englisch (UK)',
  'fr-FR': 'Französisch',
  'es-ES': 'Spanisch',
  'it-IT': 'Italienisch',
  'tr-TR': 'Türkisch',
  'nl-NL': 'Niederländisch',
};

class ReadAloudSettingsScreen extends StatelessWidget {
  const ReadAloudSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    void update(PingSettings next) => state.updateSettings(next);

    return Scaffold(
      appBar: AppBar(title: const Text('Vorlesen')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.record_voice_over_rounded),
            title: const Text('Vorlesen aktivieren'),
            subtitle:
                const Text('Zeigt „Vorlesen" im Menü einer Nachricht an.'),
            value: s.ttsEnabled,
            onChanged: (v) => update(s.copyWith(ttsEnabled: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.auto_mode_rounded),
            title: const Text('Automatisch vorlesen'),
            subtitle: const Text(
                'Liest eingehende Nachrichten im offenen Chat automatisch vor.'),
            value: s.ttsAutoRead,
            onChanged: s.ttsEnabled
                ? (v) => update(s.copyWith(ttsAutoRead: v))
                : null,
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.translate_rounded),
            title: const Text('Sprache'),
            trailing: DropdownButton<String>(
              value: _ttsLanguages.containsKey(s.ttsLanguage)
                  ? s.ttsLanguage
                  : 'de-DE',
              underline: const SizedBox.shrink(),
              items: [
                for (final e in _ttsLanguages.entries)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              onChanged: (v) =>
                  v == null ? null : update(s.copyWith(ttsLanguage: v)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: Text('Geschwindigkeit',
                style: Theme.of(context).textTheme.titleSmall),
          ),
          Slider(
            value: s.ttsRate,
            min: 0.2,
            max: 1.0,
            divisions: 8,
            label: '${(s.ttsRate * 100).round()}%',
            onChanged: (v) => update(s.copyWith(ttsRate: v)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
            child: Text('Tonhöhe', style: Theme.of(context).textTheme.titleSmall),
          ),
          Slider(
            value: s.ttsPitch,
            min: 0.5,
            max: 2.0,
            divisions: 15,
            label: s.ttsPitch.toStringAsFixed(1),
            onChanged: (v) => update(s.copyWith(ttsPitch: v)),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: FilledButton.tonalIcon(
              onPressed: () =>
                  state.tts.speak('preview', 'Hallo! So klingt Ping beim Vorlesen.'),
              icon: const Icon(Icons.play_arrow_rounded),
              label: const Text('Stimme testen'),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
