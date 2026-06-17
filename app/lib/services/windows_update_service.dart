import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'update_info.dart';

/// Where the updater is in its lifecycle. The shell shows a restart banner only
/// once we reach [ready] — the download itself happens silently in the
/// background (the user picked "automatisch im Hintergrund").
enum DesktopUpdateStage { idle, downloading, ready }

/// A downloaded, ready-to-run installer for a newer desktop build.
class DesktopUpdate {
  final String version;
  final String installerPath;
  const DesktopUpdate({required this.version, required this.installerPath});
}

/// Background auto-updater for the Windows desktop shell. On launch (and every
/// few hours) it asks the server for the newest published .exe via
/// `GET <apiBase>/api/desktop/version`. When that build is newer than the one
/// running, it silently downloads the installer to a temp file. The shell then
/// offers a one-tap "Neu starten" that runs the installer and relaunches Ping —
/// Inno Setup (same AppId) upgrades in place. Windows-only; a no-op elsewhere.
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

  /// Begin checking now, then keep checking a few times a day for long sessions.
  void start() {
    if (!supported) return;
    checkNow();
    _timer ??= Timer.periodic(const Duration(hours: 4), (_) => checkNow());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> checkNow() async {
    if (!supported || _busy || ready != null) return;
    _busy = true;
    try {
      final root = apiBase.endsWith('/')
          ? apiBase.substring(0, apiBase.length - 1)
          : apiBase;
      final res = await http
          .get(Uri.parse('$root/api/desktop/version'))
          .timeout(const Duration(seconds: 12));
      // 204 = no build published yet; anything non-200 = treat as "nothing new".
      if (res.statusCode != 200) {
        _busy = false;
        return;
      }
      final json = jsonDecodeSafe(res.body);
      final version = (json?['version'] ?? '').toString();
      final url = (json?['url'] ?? '').toString();
      final size = (json?['size'] as num?)?.toInt() ?? 0;
      if (version.isEmpty || url.isEmpty) {
        _busy = false;
        return;
      }
      final current = (await PackageInfo.fromPlatform()).version;
      if (!semverGreater(version, current)) {
        _busy = false;
        return;
      }
      await _download(version, url, size);
    } catch (_) {
      // Offline / transient — the periodic timer retries later.
    }
    _busy = false;
  }

  Future<void> _download(String version, String url, int size) async {
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/Ping-Setup-$version.exe');

      // Reuse a complete earlier download (the user dismissed the banner, then
      // relaunched) instead of fetching it all over again.
      if (await file.exists() && size > 0 && await file.length() == size) {
        ready = DesktopUpdate(version: version, installerPath: file.path);
        stage = DesktopUpdateStage.ready;
        progress = 1;
        notifyListeners();
        return;
      }

      stage = DesktopUpdateStage.downloading;
      progress = 0;
      notifyListeners();

      final client = http.Client();
      try {
        final resp = await client.send(http.Request('GET', Uri.parse(url)));
        if (resp.statusCode != 200) {
          stage = DesktopUpdateStage.idle;
          notifyListeners();
          return;
        }
        final total = resp.contentLength ?? size;
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
      if (size > 0 && await file.length() != size) {
        try {
          await file.delete();
        } catch (_) {/* best effort */}
        stage = DesktopUpdateStage.idle;
        notifyListeners();
        return;
      }

      ready = DesktopUpdate(version: version, installerPath: file.path);
      stage = DesktopUpdateStage.ready;
      progress = 1;
      notifyListeners();
    } catch (_) {
      stage = DesktopUpdateStage.idle;
      notifyListeners();
    }
  }

  /// Run the downloaded installer silently, then quit so it can replace the
  /// running files. Inno Setup re-launches Ping itself once the upgrade is done
  /// (see app/windows/installer.iss). Returns false if the installer couldn't
  /// be started (the caller keeps the banner up).
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
