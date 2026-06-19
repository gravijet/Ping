import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/crash_service.dart';
import '../widgets/brand.dart';
import 'diagnostics_screen.dart';
import 'insights_screen.dart';

/// "Entwickleroptionen" — a developer/diagnostics hub, unlocked by tapping the
/// version row seven times (the classic Android dev-options gesture). It exposes
/// the server-driven feature flags, a performance overlay toggle, build/device
/// facts, and quick links to the on-device diagnostics & stats. Nothing here
/// changes server state; it's a window, not a lever.
class DevPanelScreen extends StatelessWidget {
  const DevPanelScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final cfg = state.remoteConfig;
    final flags = cfg.flags.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    return Scaffold(
      appBar: pingAppBar(context, title: const Text('Entwickleroptionen')),
      body: ListView(
        children: [
          _Header('Build & Gerät'),
          _InfoRow('Version', _versionLabel(state)),
          _InfoRow('Plattform', _platformLabel()),
          _InfoRow('Modus', kReleaseMode ? 'Release' : 'Debug'),
          _InfoRow('Server', _shorten(state.baseUrl)),
          _InfoRow('Verbindung', state.online ? 'Online' : 'Offline'),
          _InfoRow('Min. unterstützter Build', '${cfg.minSupportedBuild}'),
          const Divider(),

          _Header('Darstellung & Performance'),
          SwitchListTile(
            secondary: const Icon(Icons.speed_rounded),
            title: const Text('Performance-Overlay'),
            subtitle: const Text('Flutter GPU-/UI-Frame-Graphen einblenden'),
            value: state.settings.showPerformanceOverlay,
            onChanged: (v) => state.updateSettings(
                state.settings.copyWith(showPerformanceOverlay: v)),
          ),
          ListTile(
            leading: const Icon(Icons.cleaning_services_outlined),
            title: const Text('Bild-Cache leeren'),
            subtitle: const Text('Gibt den Speicher der Bildvorschauen frei'),
            onTap: () {
              final freed = state.clearImageCache();
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                  content: Text('$freed Bilder aus dem Cache entfernt.')));
            },
          ),
          const Divider(),

          _Header('Feature-Flags (vom Server)'),
          if (flags.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Text('Keine Flags vom Server gesetzt.'),
            )
          else
            for (final f in flags)
              ListTile(
                dense: true,
                leading: Icon(
                  f.value ? Icons.toggle_on_rounded : Icons.toggle_off_rounded,
                  color: f.value ? scheme.primary : scheme.onSurfaceVariant,
                ),
                title: Text(f.key,
                    style: const TextStyle(
                        fontFamily: 'monospace', fontSize: 13)),
                trailing: Text(f.value ? 'an' : 'aus',
                    style: TextStyle(
                        color: f.value
                            ? scheme.primary
                            : scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w700)),
              ),
          if (cfg.values.isNotEmpty) ...[
            const SizedBox(height: 4),
            _Header('Werte (Remote-Config)'),
            for (final v in cfg.values.entries)
              _InfoRow(v.key, '${v.value}', mono: true),
          ],
          const Divider(),

          _Header('Diagnose'),
          ListTile(
            leading: const Icon(Icons.bug_report_outlined),
            title: const Text('Fehlerberichte'),
            subtitle: Text('${CrashService.instance.count} gespeichert'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const DiagnosticsScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.insights_outlined),
            title: const Text('Deine Statistik'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const InsightsScreen())),
          ),
          ListTile(
            leading: Icon(Icons.science_outlined, color: scheme.tertiary),
            title: const Text('Test-Fehler aufzeichnen'),
            subtitle: const Text(
                'Schreibt einen Beispielbericht, um die Diagnose zu prüfen'),
            onTap: () {
              CrashService.instance.record(
                Exception('Test-Diagnosebericht (manuell ausgelöst)'),
                StackTrace.current,
                context: 'DevPanel',
              );
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Test-Bericht aufgezeichnet — unter Diagnose.')));
            },
          ),
          ListTile(
            leading: const Icon(Icons.copy_all_outlined),
            title: const Text('Build-Infos kopieren'),
            onTap: () {
              Clipboard.setData(ClipboardData(
                  text: 'Ping ${_versionLabel(state)} · ${_platformLabel()} · '
                      '${kReleaseMode ? 'release' : 'debug'} · '
                      'server=${state.baseUrl}'));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Build-Infos kopiert.')));
            },
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  String _versionLabel(AppState state) =>
      state.runningVersion.isEmpty ? '—' : state.runningVersion;

  static String _platformLabel() {
    if (kIsWeb) return 'Web';
    return defaultTargetPlatform.name;
  }

  static String _shorten(String url) {
    final u = url.replaceFirst(RegExp(r'^https?://'), '');
    return u.length > 36 ? '${u.substring(0, 36)}…' : u;
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool mono;
  const _InfoRow(this.label, this.value, {this.mono = false});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(label,
                style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                fontFamily: mono ? 'monospace' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
