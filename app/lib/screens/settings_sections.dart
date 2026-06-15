import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/settings.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_lock_service.dart';
import '../services/app_state.dart';
import '../services/wallpaper_service.dart';
import '../utils/chat_sort.dart';
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
            secondary: const Icon(Icons.more_horiz_rounded),
            title: const Text('„Tippt …“ anzeigen'),
            subtitle: const Text(
                'Wenn aus, sehen andere nicht, wenn du gerade schreibst.'),
            value: s.sendTypingIndicators,
            onChanged: (v) => update(s.copyWith(sendTypingIndicators: v)),
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
          SwitchListTile(
            secondary: const Icon(Icons.visibility_off_outlined),
            title: const Text('Vorschau in der Chat-Liste verbergen'),
            subtitle: const Text(
                'Zeigt in der Übersicht nur „Neue Nachricht" statt des Textes — '
                'praktisch, wenn dir jemand über die Schulter schaut.'),
            value: s.hideListPreview,
            onChanged: (v) => update(s.copyWith(hideListPreview: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.keyboard_hide_rounded),
            title: const Text('Inkognito-Tastatur'),
            subtitle: const Text(
                'Bittet die Tastatur, beim Schreiben nichts zu lernen oder '
                'vorzuschlagen. Je nach Tastatur-App.'),
            value: s.incognitoKeyboard,
            onChanged: (v) => update(s.copyWith(incognitoKeyboard: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.delete_sweep_outlined),
            title: const Text('Vor dem Löschen nachfragen'),
            subtitle: const Text(
                'Eine Sicherheitsabfrage, bevor Nachrichten oder Chats '
                'endgültig entfernt werden.'),
            value: s.confirmBeforeDelete,
            onChanged: (v) => update(s.copyWith(confirmBeforeDelete: v)),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.lock_outline_rounded),
            title: const Text('App-Sperre'),
            subtitle: Text(state.appLockConfigured
                ? 'PIN aktiv · ${AppLock.graceLabel(s.appLockGraceSeconds)}'
                : 'Ping mit einer PIN schützen'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const AppLockSettingsScreen())),
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
          const Divider(),
          _SettingsGroupLabel('Ruhezeiten'),
          SwitchListTile(
            secondary: const Icon(Icons.bedtime_rounded),
            title: const Text('Ruhezeiten'),
            subtitle: Text(s.quietHoursEnabled
                ? 'Stumm von ${PingSettings.formatMinutes(s.quietStart)} '
                    'bis ${PingSettings.formatMinutes(s.quietEnd)} Uhr'
                : 'Nachrichten-Hinweise in einem Zeitfenster stummschalten.'),
            value: s.quietHoursEnabled,
            onChanged: s.notificationsEnabled
                ? (v) => update(s.copyWith(quietHoursEnabled: v))
                : null,
          ),
          if (s.quietHoursEnabled) ...[
            _QuietTimeTile(
              label: 'Beginn',
              minutes: s.quietStart,
              onPick: (m) => update(s.copyWith(quietStart: m)),
            ),
            _QuietTimeTile(
              label: 'Ende',
              minutes: s.quietEnd,
              onPick: (m) => update(s.copyWith(quietEnd: m)),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 8, 20, 8),
              child: Text(
                'Während der Ruhezeiten kommen Nachrichten weiterhin an — nur '
                'ganz ohne Ton und Hinweis. Wichtige Durchsagen vom Ping-Team '
                'erreichen dich trotzdem.',
                style: TextStyle(fontSize: 12.5),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A row that opens a time picker for one edge of the quiet-hours window.
class _QuietTimeTile extends StatelessWidget {
  final String label;
  final int minutes;
  final ValueChanged<int> onPick;
  const _QuietTimeTile(
      {required this.label, required this.minutes, required this.onPick});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.schedule_rounded),
      title: Text(label),
      trailing: Text(
        PingSettings.formatMinutes(minutes),
        style: Theme.of(context)
            .textTheme
            .titleMedium
            ?.copyWith(color: Theme.of(context).colorScheme.primary),
      ),
      onTap: () async {
        final picked = await showTimePicker(
          context: context,
          initialTime: TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60),
        );
        if (picked != null) onPick(picked.hour * 60 + picked.minute);
      },
    );
  }
}

/// A small uppercase section label used inside settings list views.
class _SettingsGroupLabel extends StatelessWidget {
  final String text;
  const _SettingsGroupLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 2),
      child: Text(
        text.toUpperCase(),
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
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
          SwitchListTile(
            secondary: const Icon(Icons.schedule_rounded),
            title: const Text('24-Stunden-Format'),
            subtitle: Text(s.clock24h
                ? 'Uhrzeiten als 14:30'
                : 'Uhrzeiten als 2:30 PM'),
            value: s.clock24h,
            onChanged: (v) => update(s.copyWith(clock24h: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.density_small_rounded),
            title: const Text('Kompakte Chat-Liste'),
            subtitle:
                const Text('Schmalere Zeilen — mehr Chats auf einen Blick.'),
            value: s.compactChats,
            onChanged: (v) => update(s.copyWith(compactChats: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.emoji_emotions_outlined),
            title: const Text('Große Emojis'),
            subtitle: const Text(
                'Nachrichten aus nur Emojis ohne Sprechblase groß anzeigen.'),
            value: s.bigEmoji,
            onChanged: (v) => update(s.copyWith(bigEmoji: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.format_bold_rounded),
            title: const Text('Text-Formatierung'),
            subtitle: const Text(
                'Mit *fett*, _kursiv_, ~durchgestrichen~, `Code` und '
                '||Spoiler|| Nachrichten gestalten.'),
            value: s.messageFormatting,
            onChanged: (v) => update(s.copyWith(messageFormatting: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.gradient_rounded),
            title: const Text('Farbige Sprechblasen'),
            subtitle: const Text(
                'Deine eigenen Nachrichten kräftiger in der Akzentfarbe.'),
            value: s.accentBubbles,
            onChanged: (v) => update(s.copyWith(accentBubbles: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.mood_rounded),
            title: const Text('Status im Chat-Titel'),
            subtitle: const Text(
                'Die Stimmung eines Kontakts statt „zuletzt online“ zeigen.'),
            value: s.showContactMood,
            onChanged: (v) => update(s.copyWith(showContactMood: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.emoji_emotions_rounded),
            title: const Text('Stimmungs-Emoji in der Liste'),
            subtitle: const Text(
                'Das Status-Emoji eines Kontakts neben dem Namen anzeigen.'),
            value: s.chatListMoodEmoji,
            onChanged: (v) => update(s.copyWith(chatListMoodEmoji: v)),
          ),
          const Divider(),
          _SettingsGroupLabel('Liste & Verhalten'),
          ListTile(
            leading: const Icon(Icons.sort_rounded),
            title: const Text('Sortierung'),
            subtitle: Text(ChatSortId.fromId(s.chatSort).label),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () async {
              final picked = await pickPreference<ChatSort>(
                context,
                title: 'Chats sortieren',
                current: ChatSortId.fromId(s.chatSort),
                options: {for (final m in ChatSort.values) m: m.label},
              );
              if (picked != null) update(s.copyWith(chatSort: picked.id));
            },
          ),
          ListTile(
            leading: const Icon(Icons.swipe_right_rounded),
            title: const Text('Wischen nach rechts'),
            subtitle:
                Text(kSwipeRightActions[s.swipeRightAction] ?? 'Anheften'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () async {
              final picked = await pickPreference<String>(
                context,
                title: 'Aktion beim Wischen nach rechts',
                current: kSwipeRightActions.containsKey(s.swipeRightAction)
                    ? s.swipeRightAction
                    : 'pin',
                options: kSwipeRightActions,
              );
              if (picked != null) update(s.copyWith(swipeRightAction: picked));
            },
          ),
          ListTile(
            leading: const Icon(Icons.tab_rounded),
            title: const Text('Start-Tab'),
            subtitle: Text(_startTabLabels[s.startTab] ?? 'Chats'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () async {
              final picked = await pickPreference<int>(
                context,
                title: 'Beim Öffnen anzeigen',
                current: s.startTab.clamp(0, 2),
                options: _startTabLabels,
              );
              if (picked != null) update(s.copyWith(startTab: picked));
            },
          ),
          ListTile(
            leading: const Icon(Icons.bolt_rounded),
            title: const Text('Schnellantworten'),
            subtitle: Text('${s.quickReplies.length} vorbereitet'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const QuickRepliesScreen())),
          ),
          const Divider(),
          _SettingsGroupLabel('Töne & Haptik'),
          SwitchListTile(
            secondary: const Icon(Icons.graphic_eq_rounded),
            title: const Text('Töne in der App'),
            subtitle: const Text(
                'Kurzer Ton beim Senden und bei neuen Nachrichten im offenen '
                'Chat.'),
            value: s.inAppSounds,
            onChanged: (v) => update(s.copyWith(inAppSounds: v)),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.vibration_rounded),
            title: const Text('Haptisches Feedback'),
            subtitle:
                const Text('Sanftes Vibrieren bei Aktionen wie Wischen & Senden.'),
            value: s.hapticFeedback,
            onChanged: (v) => update(s.copyWith(hapticFeedback: v)),
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
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            child: Row(
              children: [
                const Icon(Icons.brightness_4_rounded, size: 20),
                const SizedBox(width: 8),
                Text('Hintergrund abdunkeln',
                    style: Theme.of(context).textTheme.titleSmall),
                const Spacer(),
                Text('${(s.wallpaperDim / 0.6 * 100).round()}%',
                    style: TextStyle(color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
          Slider(
            value: s.wallpaperDim,
            min: 0.0,
            max: 0.6,
            divisions: 12,
            label: '${(s.wallpaperDim / 0.6 * 100).round()}%',
            onChanged: (v) => update(s.copyWith(wallpaperDim: v)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
            child: Text(
              'Legt einen dunklen Schleier über den Hintergrund, damit die '
              'Sprechblasen besser lesbar bleiben.',
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
            ),
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

// ---- Storage & data --------------------------------------------------------

String _fmtBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
  }
  return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
}

/// "Speicher & Daten": low-data mode plus the in-memory image cache, with a
/// one-tap clear. Keeps Ping light on RAM and mobile data.
class StorageSettingsScreen extends StatefulWidget {
  const StorageSettingsScreen({super.key});

  @override
  State<StorageSettingsScreen> createState() => _StorageSettingsScreenState();
}

class _StorageSettingsScreenState extends State<StorageSettingsScreen> {
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    final scheme = Theme.of(context).colorScheme;
    void update(PingSettings next) => state.updateSettings(next);

    return Scaffold(
      appBar: AppBar(title: const Text('Speicher & Daten')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.data_saver_on_rounded),
            title: const Text('Datensparmodus'),
            subtitle: const Text(
                'Hält den Bild-Zwischenspeicher klein und verzichtet auf das '
                'Vorausladen von Medien — spart mobiles Datenvolumen und '
                'Arbeitsspeicher.'),
            value: s.dataSaver,
            onChanged: (v) => update(s.copyWith(dataSaver: v)),
          ),
          const Divider(),
          _SettingsGroupLabel('Zwischenspeicher'),
          ListTile(
            leading: const Icon(Icons.image_rounded),
            title: const Text('Bild-Cache'),
            subtitle:
                Text('${_fmtBytes(state.imageCacheBytes)} im Arbeitsspeicher'),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              onPressed: () {
                final freed = state.clearImageCache();
                setState(() {});
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                  content: Text(freed > 0
                      ? '${_fmtBytes(freed)} Zwischenspeicher geleert.'
                      : 'Der Zwischenspeicher war schon leer.'),
                ));
              },
              icon: const Icon(Icons.cleaning_services_rounded),
              label: const Text('Cache leeren'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Text(
              'Heruntergeladene Bilder werden bei Bedarf neu geladen. Deine '
              'Chats, Medien und Einstellungen bleiben unberührt.',
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- App lock --------------------------------------------------------------

/// Manage the local PIN gate: turn it on/off, change the PIN, and choose how
/// quickly it re-locks after leaving the app.
class AppLockSettingsScreen extends StatelessWidget {
  const AppLockSettingsScreen({super.key});

  Future<void> _enable(BuildContext context, AppState state) async {
    final pin = await _promptPin(context,
        title: 'PIN festlegen',
        subtitle: '4–8 Ziffern. Diese PIN entsperrt Ping auf diesem Gerät.',
        confirm: true);
    if (pin == null) return;
    final ok = await state.setAppLockPin(pin);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ungültige PIN — 4–8 Ziffern.')));
    }
  }

  Future<void> _disable(BuildContext context, AppState state) async {
    final pin = await _promptPin(context,
        title: 'PIN bestätigen',
        subtitle: 'Gib deine aktuelle PIN ein, um die Sperre zu entfernen.');
    if (pin == null) return;
    if (state.tryUnlock(pin)) {
      await state.disableAppLock();
    } else if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Falsche PIN.')));
    }
  }

  Future<void> _change(BuildContext context, AppState state) async {
    final current = await _promptPin(context,
        title: 'Aktuelle PIN',
        subtitle: 'Bestätige zuerst deine aktuelle PIN.');
    if (current == null) return;
    if (!state.tryUnlock(current)) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Falsche PIN.')));
      }
      return;
    }
    if (!context.mounted) return;
    final next = await _promptPin(context,
        title: 'Neue PIN', subtitle: '4–8 Ziffern.', confirm: true);
    if (next == null) return;
    await state.setAppLockPin(next);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('PIN geändert.')));
    }
  }

  Future<void> _pickGrace(BuildContext context, AppState state) async {
    final chosen = await showModalBottomSheet<int>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final e in AppLock.graceOptions.entries)
              ListTile(
                title: Text(e.value),
                trailing: e.key == state.settings.appLockGraceSeconds
                    ? Icon(Icons.check_rounded,
                        color: Theme.of(ctx).colorScheme.primary)
                    : null,
                onTap: () => Navigator.pop(ctx, e.key),
              ),
          ],
        ),
      ),
    );
    if (chosen != null) await state.setAppLockGrace(chosen);
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.settings;
    final configured = state.appLockConfigured;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('App-Sperre')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.lock_outline_rounded),
            title: const Text('App-Sperre'),
            subtitle: const Text(
                'Ping verlangt eine PIN beim Öffnen. Die PIN bleibt nur auf '
                'diesem Gerät.'),
            value: configured,
            onChanged: (v) =>
                v ? _enable(context, state) : _disable(context, state),
          ),
          if (configured) ...[
            const Divider(),
            ListTile(
              leading: const Icon(Icons.pin_rounded),
              title: const Text('PIN ändern'),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => _change(context, state),
            ),
            ListTile(
              leading: const Icon(Icons.timer_outlined),
              title: const Text('Automatisch sperren'),
              subtitle: Text(AppLock.graceLabel(s.appLockGraceSeconds)),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => _pickGrace(context, state),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: FilledButton.tonalIcon(
                onPressed: () {
                  state.lockNow();
                  Navigator.of(context).popUntil((r) => r.isFirst);
                },
                icon: const Icon(Icons.lock_rounded),
                label: const Text('Jetzt sperren'),
              ),
            ),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text(
              'Die App-Sperre ist ein Komfort-Schutz vor neugierigen Blicken — '
              'sie ersetzt keine Geräte-Verschlüsselung. Bei vergessener PIN '
              'kannst du dich abmelden; deine Chats bleiben auf dem Server.',
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}

/// Ask for a PIN (optionally twice, when [confirm] is set for creating one).
/// Resolves to the entered PIN, or null if cancelled.
Future<String?> _promptPin(
  BuildContext context, {
  required String title,
  String? subtitle,
  bool confirm = false,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) =>
        _PinDialog(title: title, subtitle: subtitle, confirm: confirm),
  );
}

class _PinDialog extends StatefulWidget {
  final String title;
  final String? subtitle;
  final bool confirm;
  const _PinDialog({required this.title, this.subtitle, this.confirm = false});

  @override
  State<_PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<_PinDialog> {
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _submit() {
    final pin = _pin.text;
    if (!AppLock.isValidPin(pin)) {
      setState(() => _error = 'Bitte 4–8 Ziffern eingeben.');
      return;
    }
    if (widget.confirm && pin != _confirm.text) {
      setState(() => _error = 'Die PINs stimmen nicht überein.');
      return;
    }
    Navigator.pop(context, pin);
  }

  InputDecoration _dec(String label) => InputDecoration(
        labelText: label,
        counterText: '',
        prefixIcon: const Icon(Icons.lock_outline_rounded),
      );

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.subtitle != null) ...[
            Text(widget.subtitle!,
                style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontSize: 13)),
            const SizedBox(height: 14),
          ],
          TextField(
            controller: _pin,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: AppLock.maxPinLength,
            decoration: _dec('PIN'),
            onChanged: (_) => setState(() => _error = null),
            onSubmitted: (_) => widget.confirm ? null : _submit(),
          ),
          if (widget.confirm)
            TextField(
              controller: _confirm,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: AppLock.maxPinLength,
              decoration: _dec('PIN wiederholen'),
              onChanged: (_) => setState(() => _error = null),
              onSubmitted: (_) => _submit(),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(_error!,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontSize: 12.5)),
            ),
        ],
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Abbrechen')),
        FilledButton(onPressed: _submit, child: const Text('OK')),
      ],
    );
  }
}

// ---- Shared option picker --------------------------------------------------

/// Human labels for the three home tabs, keyed by index (drives the Start-Tab
/// preference).
const _startTabLabels = <int, String>{
  0: 'Chats',
  1: 'Status',
  2: 'Anrufe',
};

/// A reusable single-choice bottom sheet. Shows [options] (value → label),
/// ticks the [current] one, and resolves to the chosen value (or null if
/// dismissed). Keeps the various settings pickers consistent.
Future<T?> pickPreference<T>(
  BuildContext context, {
  required String title,
  required Map<T, String> options,
  required T current,
}) {
  return showModalBottomSheet<T>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child:
                  Text(title, style: Theme.of(ctx).textTheme.titleMedium),
            ),
          ),
          for (final e in options.entries)
            ListTile(
              title: Text(e.value),
              trailing: e.key == current
                  ? Icon(Icons.check_rounded,
                      color: Theme.of(ctx).colorScheme.primary)
                  : null,
              onTap: () => Navigator.pop(ctx, e.key),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

// ---- Quick replies ---------------------------------------------------------

/// Manage the canned messages offered from the composer: add, edit, remove and
/// reset to the built-in starter set.
class QuickRepliesScreen extends StatelessWidget {
  const QuickRepliesScreen({super.key});

  Future<void> _addOrEdit(BuildContext context, AppState state,
      {int? index}) async {
    final initial = index == null ? '' : state.quickReplies[index];
    final text = await showDialog<String>(
      context: context,
      builder: (_) => _QuickReplyDialog(initial: initial),
    );
    if (text == null) return;
    if (index == null) {
      await state.addQuickReply(text);
    } else {
      await state.editQuickReply(index, text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final replies = state.quickReplies;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Schnellantworten'),
        actions: [
          IconButton(
            tooltip: 'Zurücksetzen',
            icon: const Icon(Icons.restart_alt_rounded),
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Zurücksetzen?'),
                  content: const Text(
                      'Setzt die Schnellantworten auf die Standardliste zurück.'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('Abbrechen')),
                    FilledButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Zurücksetzen')),
                  ],
                ),
              );
              if (ok == true) await state.resetQuickReplies();
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _addOrEdit(context, state),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Neu'),
      ),
      body: replies.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Text(
                  'Noch keine Schnellantworten. Tippe auf „Neu", um eine '
                  'anzulegen.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.only(bottom: 96),
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 12, 20, 4),
                  child: Text(
                    'Diese Texte lassen sich im Chat über das Blitz-Symbol mit '
                    'einem Tippen einfügen.',
                    style: TextStyle(fontSize: 12.5),
                  ),
                ),
                for (var i = 0; i < replies.length; i++)
                  Dismissible(
                    key: ValueKey('qr-$i-${replies[i]}'),
                    direction: DismissDirection.endToStart,
                    background: Container(
                      color: scheme.errorContainer,
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Icon(Icons.delete_rounded,
                          color: scheme.onErrorContainer),
                    ),
                    onDismissed: (_) => state.removeQuickReply(i),
                    child: ListTile(
                      leading: const Icon(Icons.bolt_rounded),
                      title: Text(replies[i]),
                      trailing: const Icon(Icons.edit_outlined),
                      onTap: () => _addOrEdit(context, state, index: i),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _QuickReplyDialog extends StatefulWidget {
  final String initial;
  const _QuickReplyDialog({required this.initial});

  @override
  State<_QuickReplyDialog> createState() => _QuickReplyDialogState();
}

class _QuickReplyDialogState extends State<_QuickReplyDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.initial.isEmpty
          ? 'Neue Schnellantwort'
          : 'Schnellantwort bearbeiten'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        maxLength: 200,
        maxLines: 3,
        minLines: 1,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(hintText: 'Text der Antwort'),
        onSubmitted: (v) => Navigator.pop(context, v),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Abbrechen')),
        FilledButton(
          onPressed: () => Navigator.pop(context, _controller.text),
          child: const Text('Speichern'),
        ),
      ],
    );
  }
}
