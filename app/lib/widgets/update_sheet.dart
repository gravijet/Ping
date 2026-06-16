import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/update_service.dart';
import 'changelog_view.dart';

/// Show the in-app update flow: checks for the newest build, then downloads and
/// launches the Android package installer with a live progress bar.
Future<void> showUpdateSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _UpdateSheet(),
  );
}

class _UpdateSheet extends StatefulWidget {
  const _UpdateSheet();

  @override
  State<_UpdateSheet> createState() => _UpdateSheetState();
}

enum _Phase { checking, available, upToDate, downloading, installing, error }

class _UpdateSheetState extends State<_UpdateSheet> {
  _Phase _phase = _Phase.checking;
  UpdateInfo? _info;
  double _progress = 0;
  String _current = '';
  bool _downloaded = false; // a verified APK for this build is already cached
  List<Map<String, dynamic>> _changelog = const [];

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    final state = context.read<AppState>();
    _current = await state.updater.currentVersion();
    if (!state.updater.supported) {
      if (mounted) setState(() => _phase = _Phase.upToDate);
      return;
    }
    // Use the cached result if we already have one, otherwise fetch fresh.
    var info = state.availableUpdate;
    if (info == null) {
      final fetched = await state.updater.fetch(state.baseUrl);
      if (fetched != null && await state.updater.isNewer(fetched)) {
        info = fetched;
        state.availableUpdate = fetched;
      }
    }
    if (!mounted) return;
    setState(() {
      _info = info;
      _phase = info != null ? _Phase.available : _Phase.upToDate;
    });
    // Show what's new for the offered version, if the changelog has an entry.
    if (info != null) {
      // If the user already pulled this build down (and just cancelled the
      // install), we can offer to install it straight away — no re-download.
      final cached = await state.updater.cachedApk(info);
      if (mounted) setState(() => _downloaded = cached != null);
      final cl = await state.changelogFor(info.version);
      if (mounted) setState(() => _changelog = cl);
    }
  }

  Future<void> _downloadAndInstall() async {
    final state = context.read<AppState>();
    final info = _info;
    if (info == null) return;
    setState(() {
      // A cached build installs immediately; only show the progress bar when we
      // actually have to fetch bytes.
      _phase = _downloaded ? _Phase.installing : _Phase.downloading;
      _progress = 0;
    });
    final String? path = await state.updater.download(
      info,
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    if (!mounted) return;
    if (path == null) {
      setState(() => _phase = _Phase.error);
      return;
    }
    setState(() => _phase = _Phase.installing);
    final ok = await state.updater.install(path);
    if (!mounted) return;
    if (!ok) {
      setState(() => _phase = _Phase.error);
    } else {
      // The system installer is now in front; close the sheet.
      Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 4, 24, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                    colors: [scheme.primary, scheme.tertiary]),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.system_update_rounded,
                  color: Colors.white, size: 34),
            ),
            const SizedBox(height: 16),
            ..._body(scheme),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(ColorScheme scheme) {
    switch (_phase) {
      case _Phase.checking:
        return const [
          Text('Suche nach Updates …',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          SizedBox(height: 18),
          LinearProgressIndicator(),
        ];
      case _Phase.upToDate:
        return [
          const Text('Alles aktuell',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('Du nutzt bereits die neueste Version ($_current).',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: const Text('Schließen'),
          ),
        ];
      case _Phase.available:
        final info = _info!;
        return [
          const Text('Update verfügbar',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          _versionRow('Installiert', _current, scheme),
          _versionRow('Neu', info.version, scheme, highlight: true),
          _versionRow('Größe', _human(info.size), scheme),
          if (_changelog.isNotEmpty) ...[
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerLeft,
              child: Text('Was ist neu',
                  style: TextStyle(
                      fontWeight: FontWeight.w700, color: scheme.onSurface)),
            ),
            const SizedBox(height: 4),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: SingleChildScrollView(
                child: ChangelogList(entries: _changelog),
              ),
            ),
          ],
          if (_downloaded) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.primaryContainer.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(Icons.check_circle_rounded,
                      size: 18, color: scheme.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Bereits heruntergeladen – du kannst direkt installieren, '
                      'ohne erneut zu laden.',
                      style: TextStyle(
                          fontSize: 12.5,
                          height: 1.35,
                          color: scheme.onSurface),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _downloadAndInstall,
              icon: Icon(_downloaded
                  ? Icons.install_mobile_rounded
                  : Icons.download_rounded),
              label: Text(_downloaded
                  ? 'Jetzt installieren'
                  : 'Herunterladen & installieren'),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Android fragt dich anschließend, ob die Installation erlaubt ist.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ];
      case _Phase.downloading:
        return [
          const Text('Wird heruntergeladen …',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 18),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
                value: _progress > 0 ? _progress : null, minHeight: 8),
          ),
          const SizedBox(height: 8),
          Text('${(_progress * 100).round()} %',
              style: TextStyle(color: scheme.onSurfaceVariant)),
        ];
      case _Phase.installing:
        return const [
          Text('Installation wird gestartet …',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          SizedBox(height: 18),
          LinearProgressIndicator(),
        ];
      case _Phase.error:
        return [
          Text('Update fehlgeschlagen',
              style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: scheme.error)),
          const SizedBox(height: 8),
          Text(
            'Der Download oder die Installation hat nicht geklappt. '
            'Prüfe deine Internetverbindung und versuche es erneut.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline_rounded,
                    size: 18, color: scheme.onSurfaceVariant),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Meldet Android „App nicht installiert“? Deinstalliere die '
                    'alte Version einmalig und installiere die neue danach – '
                    'künftige Updates laufen dann automatisch.',
                    style: TextStyle(
                        fontSize: 12.5,
                        height: 1.35,
                        color: scheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('Schließen'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _downloadAndInstall,
                  child: const Text('Erneut versuchen'),
                ),
              ),
            ],
          ),
        ];
    }
  }

  Widget _versionRow(String label, String value, ColorScheme scheme,
      {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: scheme.onSurfaceVariant)),
          Text(value,
              style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: highlight ? scheme.primary : scheme.onSurface)),
        ],
      ),
    );
  }

  String _human(int bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    var n = bytes.toDouble();
    var i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return '${n.toStringAsFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}';
  }
}
