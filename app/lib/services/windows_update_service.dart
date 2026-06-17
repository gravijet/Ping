import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'update_info.dart';

/// Where the updater is in its lifecycle. The startup flow walks
/// idle → checking → (downloading → installing) and the shell paints a matching
/// screen for each. [ready] means an installer is downloaded but not yet applied
/// (used by the background fallback path for long-running sessions).
enum DesktopUpdateStage { idle, checking, downloading, ready, installing }

/// A downloaded, ready-to-run installer for a newer desktop build.
class DesktopUpdate {
  final String version;
  final String installerPath;
  const DesktopUpdate({required this.version, required this.installerPath});
}

/// What `GET /api/desktop/version` advertised: the newest published .exe.
class _Latest {
  final String version;
  final String url;
  final int size;
  const _Latest(this.version, this.url, this.size);
}

/// Auto-updater for the Windows desktop shell. Two entry points:
///
///  * [runStartupUpdate] — the Discord-style blocking flow. On launch the shell
///    awaits this *before* showing the web client: it checks the server, and if
///    a newer build exists, downloads it (with progress) and installs it,
///    relaunching Ping on the new version. If nothing's new — or the check is
///    slow/offline — it returns quickly and the app starts normally.
///  * [start] — a lightweight periodic fallback for very long sessions. It only
///    arms a timer; when it finds a newer build it downloads it and flips to
///    [DesktopUpdateStage.ready] so the shell can offer a "restart" banner.
///
/// Windows-only; every method is a no-op elsewhere.
class WindowsUpdateService extends ChangeNotifier {
  WindowsUpdateService(this.apiBase);

  /// Web client origin, e.g. `https://example.invalid`. The version
  /// manifest is same-origin to the shell's WebView, so it's always reachable.
  final String apiBase;

  DesktopUpdateStage stage = DesktopUpdateStage.idle;
  DesktopUpdate? ready;
  double progress = 0; // 0..1 while downloading

  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.windows;

  Timer? _timer;
  bool _busy = false;
  bool _skipStartup = false;

  /// User asked to skip the launch update. The download (if any) finishes in the
  /// background and surfaces as a restart banner instead of installing now.
  void skipStartup() {
    _skipStartup = true;
    notifyListeners();
  }

  String get _root => apiBase.endsWith('/')
      ? apiBase.substring(0, apiBase.length - 1)
      : apiBase;

  /// Blocking launch-time update. Returns when there's nothing to do (no newer
  /// build, offline, or the check timed out); does NOT return when it installs
  /// an update — the process exits and the installer relaunches Ping.
  Future<void> runStartupUpdate({
    Duration checkTimeout = const Duration(seconds: 9),
  }) async {
    if (!supported || _busy) return;
    _busy = true;
    try {
      stage = DesktopUpdateStage.checking;
      notifyListeners();

      final latest = await _fetchLatest(timeout: checkTimeout);
      if (latest == null) {
        stage = DesktopUpdateStage.idle;
        notifyListeners();
        return;
      }

      final ok = await _download(latest);
      if (!ok || ready == null) {
        stage = DesktopUpdateStage.idle;
        notifyListeners();
        return;
      }

      // The user skipped during the check/download: leave the installer ready
      // and let the shell offer a "Neu starten" banner instead of cutting in.
      if (_skipStartup) {
        stage = DesktopUpdateStage.ready;
        notifyListeners();
        return;
      }

      stage = DesktopUpdateStage.installing;
      notifyListeners();
      // Give the UI a frame to paint "wird installiert" before we hand off.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await installAndRestart(); // exits the process on success
      // If we got here the installer failed to start — fall through to launch.
      stage = DesktopUpdateStage.idle;
      notifyListeners();
    } catch (_) {
      stage = DesktopUpdateStage.idle;
      notifyListeners();
    } finally {
      _busy = false;
    }
  }

  /// Arm the background fallback check for long sessions. Does not check now —
  /// [runStartupUpdate] already handled the launch check.
  void start() {
    if (!supported) return;
    _timer ??= Timer.periodic(const Duration(hours: 4), (_) => checkNow());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Background (non-blocking) check used by the periodic timer. Downloads a
  /// newer build silently and flips to [ready] so the shell shows a banner.
  Future<void> checkNow() async {
    if (!supported || _busy || ready != null) return;
    _busy = true;
    try {
      final latest = await _fetchLatest(timeout: const Duration(seconds: 12));
      if (latest != null) await _download(latest);
    } catch (_) {
      // Offline / transient — the periodic timer retries later.
    }
    _busy = false;
  }

  /// Ask the server for the newest published .exe and return it only when it's
  /// strictly newer than the running build. Null = nothing to do.
  Future<_Latest?> _fetchLatest({required Duration timeout}) async {
    final res = await http
        .get(Uri.parse('$_root/api/desktop/version'))
        .timeout(timeout);
    // 204 = no build published yet; anything non-200 = treat as "nothing new".
    if (res.statusCode != 200) return null;
    final json = jsonDecodeSafe(res.body);
    final version = (json?['version'] ?? '').toString();
    final url = (json?['url'] ?? '').toString();
    final size = (json?['size'] as num?)?.toInt() ?? 0;
    if (version.isEmpty || url.isEmpty) return null;
    final current = (await PackageInfo.fromPlatform()).version;
    if (!semverGreater(version, current)) return null;
    return _Latest(version, url, size);
  }

  Future<bool> _download(_Latest latest) async {
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/Ping-Setup-${latest.version}.exe');

      // Reuse a complete earlier download (the user dismissed a banner, then
      // relaunched) instead of fetching it all over again.
      if (await file.exists() &&
          latest.size > 0 &&
          await file.length() == latest.size) {
        ready = DesktopUpdate(version: latest.version, installerPath: file.path);
        stage = DesktopUpdateStage.ready;
        progress = 1;
        notifyListeners();
        return true;
      }

      stage = DesktopUpdateStage.downloading;
      progress = 0;
      notifyListeners();

      final client = http.Client();
      try {
        final resp = await client.send(http.Request('GET', Uri.parse(latest.url)));
        if (resp.statusCode != 200) return false;
        final total = resp.contentLength ?? latest.size;
        final sink = file.openWrite();
        var received = 0;
        await for (final chunk in resp.stream) {
          sink.add(chunk);
          received += chunk.length;
          if (total > 0) {
            progress = (received / total).clamp(0.0, 1.0);
            notifyListeners();
          }
        }
        await sink.flush();
        await sink.close();
      } finally {
        client.close();
      }

      // Sanity-check the size we got against what the server advertised.
      if (latest.size > 0 && await file.length() != latest.size) {
        try {
          await file.delete();
        } catch (_) {/* best effort */}
        return false;
      }

      ready = DesktopUpdate(version: latest.version, installerPath: file.path);
      stage = DesktopUpdateStage.ready;
      progress = 1;
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Run the downloaded installer silently, then quit so it can replace the
  /// running files. Inno Setup re-launches Ping itself once the upgrade is done
  /// (see app/windows/installer.iss). Returns false if the installer couldn't
  /// be started (the caller keeps going / shows the banner).
  Future<bool> installAndRestart() async {
    final r = ready;
    if (r == null) return false;
    try {
      await Process.start(
        r.installerPath,
        ['/SILENT', '/NORESTART', '/SUPPRESSMSGBOXES'],
        mode: ProcessStartMode.detached,
      );
    } catch (_) {
      return false;
    }
    // Let the installer spawn before we release the file locks on our own exe.
    await Future<void>.delayed(const Duration(milliseconds: 500));
    exit(0);
  }
}
