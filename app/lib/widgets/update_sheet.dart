import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/update_service.dart';
import 'changelog_view.dart';

/// Show the in-app update flow: checks for the newest build, then downloads it in
/// the background (Android's DownloadManager) and launches the package installer.
/// The download keeps running if the user leaves the app, and is rejoined the
/// next time this sheet opens.
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

enum _Phase {
  checking,
  available,
  upToDate,
  downloading,
  installing,
  permission, // app isn't allowed to install apps yet → guide the user to grant it
  error,
}

class _UpdateSheetState extends State<_UpdateSheet> {
  _Phase _phase = _Phase.checking;
  UpdateInfo? _info;
  UpdateService? _updater;
  String _baseUrl = '';
  double? _progress; // null → indeterminate
  String _current = '';
  bool _downloaded = false; // a verified APK for this build is ready to install
  int? _dlId; // active/finished background-download id (install handle)
  String? _cachedPath; // legacy in-process download path (install handle)
  Timer? _poll;
  Timer? _installPoll; // watches for the installer's real failure reason
  String? _failReason; // actual install failure reason, when the OS reported one
  List<Map<String, dynamic>> _changelog = const [];

  @override
  void initState() {
    super.initState();
    _check();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _installPoll?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    final state = context.read<AppState>();
    final updater = _updater = state.updater;
    _baseUrl = state.baseUrl;
    _current = await updater.currentVersion();
    if (!updater.supported) {
      if (mounted) setState(() => _phase = _Phase.upToDate);
      return;
    }
    // Use the cached result if we already have one, otherwise fetch fresh.
    var info = state.availableUpdate;
    if (info == null) {
      final fetched = await updater.fetch(state.baseUrl);
      if (fetched != null && await updater.isNewer(fetched)) {
        info = fetched;
        state.availableUpdate = fetched;
      }
    }
    if (!mounted) return;
    setState(() {
      _info = info;
      _phase = info != null ? _Phase.available : _Phase.upToDate;
    });
    if (info == null) return;
    unawaited(updater.reportEvent(state.baseUrl, 'update_offered'));

    // What's new for the offered version, if the changelog has an entry.
    final cl = await state.changelogFor(info.version);
    if (mounted) setState(() => _changelog = cl);

    // Rejoin a download that ran (or finished) while we were away — the app may
    // have been backgrounded or even killed since it started.
    final pending = await updater.pendingDownload(info);
    if (pending != null) {
      final status = await updater.backgroundStatus(pending.id);
      if (status.isDone) {
        final path = await updater.verifiedPath(status, info);
        if (path != null) {
          _dlId = pending.id;
          if (mounted) setState(() => _downloaded = true);
          return;
        }
        await updater.clearPending(); // finished but unverifiable → re-offer
      } else if (status.isActive) {
        _dlId = pending.id;
        if (mounted) {
          setState(() {
            _phase = _Phase.downloading;
            _progress = status.fraction;
          });
        }
        _startPolling();
        return;
      } else {
        await updater.clearPending();
      }
    }

    // Legacy in-process cache (a download finished the old way before upgrading).
    final cached = await updater.cachedApk(info);
    if (mounted && cached != null) {
      setState(() {
        _downloaded = true;
        _cachedPath = cached;
      });
    }
  }

  /// Begin (or, when already downloaded, skip straight to installing).
  Future<void> _start() async {
    final updater = _updater;
    final info = _info;
    if (updater == null || info == null) return;
    if (_downloaded) {
      await _install();
      return;
    }
    unawaited(updater.reportEvent(_baseUrl, 'update_started'));
    setState(() {
      _phase = _Phase.downloading;
      _progress = null;
    });
    if (updater.supportsBackgroundDownload) {
      final id = await updater.startBackgroundDownload(info);
      if (!mounted) return;
      if (id == null) {
        // The OS download couldn't start — fall back to an in-process fetch.
        await _downloadInProcess();
        return;
      }
      _dlId = id;
      _startPolling();
    } else {
      await _downloadInProcess();
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(milliseconds: 600), (t) async {
      final updater = _updater;
      final info = _info;
      final id = _dlId;
      if (updater == null || info == null || id == null) {
        t.cancel();
        return;
      }
      final status = await updater.backgroundStatus(id);
      if (!mounted) {
        t.cancel();
        return;
      }
      if (status.isActive) {
        setState(() {
          _phase = _Phase.downloading;
          _progress = status.fraction;
        });
      } else if (status.isDone) {
        t.cancel();
        final path = await updater.verifiedPath(status, info);
        if (!mounted) return;
        if (path == null) {
          await updater.clearPending();
          unawaited(updater.reportEvent(_baseUrl, 'update_failed'));
          setState(() => _phase = _Phase.error);
          return;
        }
        unawaited(updater.reportEvent(_baseUrl, 'update_downloaded'));
        setState(() {
          _downloaded = true;
          _progress = 1.0;
        });
        await _install();
      } else {
        t.cancel();
        await updater.clearPending();
        unawaited(updater.reportEvent(_baseUrl, 'update_failed'));
        if (mounted) setState(() => _phase = _Phase.error);
      }
    });
  }

  /// Fallback path: stream the APK inside the app (only when the OS download
  /// isn't available). Doesn't survive backgrounding — hence the fallback.
  Future<void> _downloadInProcess() async {
    final updater = _updater;
    final info = _info;
    if (updater == null || info == null) return;
    if (mounted) {
      setState(() {
        _phase = _Phase.downloading;
        _progress = 0;
      });
    }
    final path = await updater.download(
      info,
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    if (!mounted) return;
    if (path == null) {
      unawaited(updater.reportEvent(_baseUrl, 'update_failed'));
      setState(() => _phase = _Phase.error);
      return;
    }
    unawaited(updater.reportEvent(_baseUrl, 'update_downloaded'));
    _cachedPath = path;
    await _install();
  }

  Future<void> _install() async {
    final updater = _updater;
    if (updater == null) return;
    // Pre-flight: an update can only install if the app holds the "Install unknown
    // apps" consent. Without it the install would silently fail — so route the
    // user to grant it first instead of letting them hit a dead end.
    if (!await updater.canInstall()) {
      if (mounted) setState(() => _phase = _Phase.permission);
      return;
    }
    if (mounted) {
      setState(() {
        _failReason = null;
        _phase = _Phase.installing;
      });
    }
    // Clear any stale reason from a previous attempt so the poll below only sees
    // a fresh failure.
    await updater.installError();
    bool ok;
    if (_dlId != null) {
      ok = await updater.installBackground(_dlId!);
    } else if (_cachedPath != null) {
      ok = await updater.install(_cachedPath!);
    } else {
      ok = false;
    }
    if (!mounted) return;
    if (!ok) {
      unawaited(updater.reportEvent(_baseUrl, 'update_failed'));
      setState(() {
        _failReason = null;
        _phase = _Phase.error;
      });
      return;
    }
    unawaited(updater.reportEvent(_baseUrl, 'update_install_launched'));
    // The system's confirm dialog is now in front. Watch for a failure the
    // installer reports back (e.g. blocked by Samsung Auto Blocker); a success
    // replaces our process, so this poll simply dies with it.
    _watchInstallResult();
  }

  void _watchInstallResult() {
    _installPoll?.cancel();
    var ticks = 0;
    _installPoll = Timer.periodic(const Duration(milliseconds: 1200), (t) async {
      ticks++;
      final reason = await _updater?.installError();
      if (!mounted) {
        t.cancel();
        return;
      }
      if (reason != null) {
        t.cancel();
        unawaited(_updater?.reportEvent(_baseUrl, 'update_failed'));
        setState(() {
          _failReason = reason;
          _phase = _Phase.error;
        });
      } else if (ticks >= 75) {
        // ~90s with nothing reported: it quietly succeeded or the user is still
        // deciding. Step out of the way.
        t.cancel();
        if (mounted) Navigator.of(context).maybePop();
      }
    });
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
            _infoBox(
              scheme,
              Icons.check_circle_rounded,
              'Bereits heruntergeladen – du kannst direkt installieren, '
              'ohne erneut zu laden.',
              tint: scheme.primaryContainer.withValues(alpha: 0.5),
              icon: scheme.primary,
            ),
          ],
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _start,
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
            _downloaded
                ? 'Android fragt dich anschließend, ob die Installation erlaubt ist.'
                : 'Der Download läuft im Hintergrund weiter, auch wenn du Ping '
                    'verlässt. Android fragt danach, ob installiert werden darf.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ];
      case _Phase.downloading:
        final pct = _progress;
        return [
          const Text('Wird heruntergeladen …',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 18),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(value: pct, minHeight: 8),
          ),
          const SizedBox(height: 8),
          Text(pct != null ? '${(pct * 100).round()} %' : 'Wird vorbereitet …',
              style: TextStyle(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 14),
          _infoBox(
            scheme,
            Icons.cloud_download_rounded,
            'Du kannst Ping jetzt schließen oder zu einer anderen App wechseln – '
            'der Download läuft im Hintergrund weiter und meldet sich, wenn er '
            'fertig ist.',
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.minimize_rounded),
              label: const Text('Im Hintergrund laden'),
            ),
          ),
        ];
      case _Phase.installing:
        return const [
          Text('Installation wird gestartet …',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          SizedBox(height: 18),
          LinearProgressIndicator(),
        ];
      case _Phase.permission:
        return [
          const Text('Installation erlauben',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(
            'Damit Ping das Update installieren kann, musst du es einmalig '
            'erlauben. Android öffnet die Einstellung — aktiviere dort '
            '„Aus dieser Quelle zulassen" und komm zurück.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () async {
                await _updater?.requestInstallPermission();
              },
              icon: const Icon(Icons.settings_rounded),
              label: const Text('Einstellung öffnen'),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              // Back from settings → try the install again; if granted it proceeds.
              onPressed: _install,
              child: const Text('Erlaubt — weiter'),
            ),
          ),
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
            _failReason ??
                'Der Download oder die Installation hat nicht geklappt. '
                    'Prüfe deine Internetverbindung und versuche es erneut.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          _infoBox(
            scheme,
            Icons.info_outline_rounded,
            'Bleibt es hängen? Bei Samsung kann „Auto Blocker" (Einstellungen → '
            'Sicherheit) die Installation verhindern – kurz ausschalten. Sonst hilft, '
            'die alte Version einmalig zu deinstallieren und neu zu installieren; '
            'künftige Updates laufen dann automatisch.',
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
                  onPressed: _start,
                  child: const Text('Erneut versuchen'),
                ),
              ),
            ],
          ),
        ];
    }
  }

  Widget _infoBox(ColorScheme scheme, IconData glyph, String text,
      {Color? tint, Color? icon}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tint ?? scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(glyph, size: 18, color: icon ?? scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                  fontSize: 12.5, height: 1.35, color: scheme.onSurface),
            ),
          ),
        ],
      ),
    );
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
