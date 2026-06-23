import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'update_info.dart';

/// Checks the server for a newer APK and, on demand, downloads and launches the
/// Android package installer. Android-only; no-ops elsewhere. Public methods
/// hand back file *paths* (strings) so the shared UI never needs `dart:io`.
class UpdateService {
  static const _native = MethodChannel('ping/native');

  /// SharedPreferences key holding the JSON of the one in-flight background
  /// download (id + which build it's for), so it survives the app being killed.
  static const _kPending = 'ping_pending_apk';

  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Whether downloads can be handed to the OS to run in the background. True on
  /// Android (system DownloadManager); the in-process [download] is the fallback.
  bool get supportsBackgroundDownload => supported;

  PackageInfo? _package;
  String? _abi;

  Future<PackageInfo> _info() async => _package ??= await PackageInfo.fromPlatform();

  /// The device's primary CPU ABI (e.g. "arm64-v8a"), used to pick the matching
  /// APK split. Empty string when it can't be determined; cached after first read.
  Future<String> _deviceAbi() async {
    if (!supported) return '';
    if (_abi != null) return _abi!;
    try {
      _abi = await _native.invokeMethod<String>('primaryAbi') ?? '';
    } catch (_) {
      _abi = '';
    }
    return _abi!;
  }

  /// The running app's version name, e.g. "0.1.0".
  Future<String> currentVersion() async => (await _info()).version;

  /// The running app's build number (android versionCode), e.g. 4.
  Future<int> currentBuildNumber() async =>
      int.tryParse((await _info()).buildNumber) ?? 0;

  /// Fetch metadata about the newest published build. Returns null on any error
  /// (offline, no build yet) so callers can treat it as "no update".
  Future<UpdateInfo?> fetch(String baseUrl) async {
    if (!supported) return null;
    final root =
        baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    try {
      final res = await http
          .get(Uri.parse('$root/download/info'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return null;
      final json = jsonDecodeSafe(res.body);
      if (json == null) return null;
      final info = UpdateInfo.fromJson(json, root);
      // Prefer the per-ABI split that matches this device — a far smaller
      // download — falling back to the universal APK when there's no match.
      final variants = json['variants'];
      if (variants is Map) {
        final abi = await _deviceAbi();
        final v = abi.isNotEmpty ? variants[abi] : null;
        if (v is Map && v['url'] != null) {
          final rel = v['url'].toString();
          // Every variant now shares the universal build's version code (we build
          // splits via AGP, not Flutter's `--split-per-abi`, so there's no ABI
          // offset any more), but we still read the split's advertised code and
          // fall back to the universal one — robust if an older, inflated build is
          // ever in the mix.
          final vCode = v['versionCode'] is int
              ? v['versionCode'] as int
              : int.tryParse('${v['versionCode'] ?? ''}');
          return UpdateInfo(
            version: (v['version'] ?? info.version).toString(),
            build: info.build,
            versionCode: vCode ?? info.versionCode,
            size: (v['size'] as num?)?.toInt() ?? info.size,
            sha256: (v['sha256'] ?? info.sha256).toString(),
            downloadUrl: rel.startsWith('http') ? rel : '$root$rel',
          );
        }
      }
      return info;
    } catch (_) {
      return null;
    }
  }

  /// Whether [info] is newer than what's installed. An update is offered when
  /// *either* the integer version code or the marketing version is higher. The
  /// version-name check is a backstop that keeps working even for users still on
  /// an old inflated per-ABI version code (pre-0.36.1 splits), who would otherwise
  /// see the new, lower, flattened code as "not newer".
  Future<bool> isNewer(UpdateInfo info) async {
    if (!supported) return false;
    final code = info.versionCode;
    final byCode = code != null && code > await currentBuildNumber();
    final byName = semverGreater(info.version, await currentVersion());
    return byCode || byName;
  }

  /// The stable on-disk path an APK for [info] downloads to. The same build
  /// always maps to the same filename, so a download that finished but whose
  /// install the user cancelled can be reused instead of fetched again.
  Future<File> _apkFile(UpdateInfo info) async {
    final dir = await getTemporaryDirectory();
    return File('${dir.path}/ping-${info.build.replaceAll('+', '-')}.apk');
  }

  /// Whether [file]'s bytes match [sha]. Returns false when there's no hash to
  /// check against — we'd rather re-download than install something unverified.
  Future<bool> _matchesHash(File file, String sha) async {
    if (sha.isEmpty) return false;
    try {
      final digest = await sha256.bind(file.openRead()).first;
      return digest.toString().toLowerCase() == sha.toLowerCase();
    } catch (_) {
      return false;
    }
  }

  Future<File?> _cachedApkFile(UpdateInfo info) async {
    if (!supported) return null;
    try {
      final file = await _apkFile(info);
      if (!await file.exists()) return null;
      // Size is the cheap pre-check; the sha256 (when advertised) is the
      // authoritative one. A half-written file from an aborted download fails
      // both and is treated as "not cached".
      final len = await file.length();
      if (info.size > 0 && len != info.size) return null;
      if (info.sha256.isNotEmpty && !await _matchesHash(file, info.sha256)) {
        return null;
      }
      if (info.sha256.isEmpty && info.size <= 0) return null;
      return file;
    } catch (_) {
      return null;
    }
  }

  /// Path of an already-downloaded, integrity-checked APK for [info] sitting in
  /// the cache — e.g. the user downloaded it earlier but dismissed Android's
  /// install prompt. Null when there's nothing valid to reuse.
  Future<String?> cachedApk(UpdateInfo info) async =>
      (await _cachedApkFile(info))?.path;

  /// Delete every cached `ping-*.apk` except [keep], so a stale download from a
  /// previous version doesn't sit around eating storage forever.
  Future<void> _pruneOldApks(File keep) async {
    try {
      final dir = await getTemporaryDirectory();
      await for (final entity in dir.list()) {
        if (entity is! File) continue;
        final name = entity.uri.pathSegments.last;
        if (name.startsWith('ping-') &&
            name.endsWith('.apk') &&
            entity.path != keep.path) {
          try {
            await entity.delete();
          } catch (_) {
            /* best effort */
          }
        }
      }
    } catch (_) {
      /* best effort */
    }
  }

  /// Download the APK to a temp file, reporting progress in 0..1. Returns the
  /// file's path, or null on failure. If a verified copy of this exact build is
  /// already cached (a previously interrupted install), it's reused instantly.
  Future<String?> download(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    if (!supported) return null;
    // Resume: reuse a complete, integrity-checked download if we have one.
    final cached = await _cachedApkFile(info);
    if (cached != null) {
      onProgress?.call(1.0);
      return cached.path;
    }
    try {
      final file = await _apkFile(info);
      final client = http.Client();
      try {
        final req = http.Request('GET', Uri.parse(info.downloadUrl));
        final resp = await client.send(req);
        if (resp.statusCode != 200) return null;
        final total = resp.contentLength ?? info.size;
        final sink = file.openWrite();
        var received = 0;
        await for (final chunk in resp.stream) {
          sink.add(chunk);
          received += chunk.length;
          if (total > 0) onProgress?.call((received / total).clamp(0.0, 1.0));
        }
        await sink.flush();
        await sink.close();
        // Integrity check: the downloaded APK must match the server's sha256.
        // Protects against a corrupted or tampered download before we install.
        if (info.sha256.isNotEmpty) {
          if (!await _matchesHash(file, info.sha256)) {
            try {
              await file.delete();
            } catch (_) {
              /* ignore */
            }
            return null;
          }
        }
        // Free the storage taken by any older build's cached APK.
        await _pruneOldApks(file);
        return file.path;
      } finally {
        client.close();
      }
    } catch (_) {
      return null;
    }
  }

  /// Install the downloaded APK at [path]. Prefers the native PackageInstaller
  /// session (reliable handoff + real failure reason); falls back to letting the
  /// OS open the file if the session can't be created.
  Future<bool> install(String path) async {
    if (!supported) return false;
    try {
      final ok = await _native.invokeMethod<bool>('apkInstallPath', {'path': path});
      if (ok == true) return true;
    } catch (_) {
      /* fall through to the OS open below */
    }
    try {
      final result = await OpenFilex.open(
        path,
        type: 'application/vnd.android.package-archive',
      );
      return result.type == ResultType.done;
    } catch (_) {
      return false;
    }
  }

  /// Whether the app is allowed to install APKs at all. Android 8+ gates
  /// sideloading behind a per-app "Install unknown apps" consent; without it
  /// every update install fails. Defaults to true so a failure here never blocks
  /// the flow (the install itself would still surface a real error).
  Future<bool> canInstall() async {
    if (!supported) return true;
    try {
      return await _native.invokeMethod<bool>('canInstallPackages') ?? true;
    } catch (_) {
      return true;
    }
  }

  /// Open the system screen where the user grants this app the install consent.
  Future<void> requestInstallPermission() async {
    if (!supported) return;
    try {
      await _native.invokeMethod('requestInstallPermission');
    } catch (_) {
      /* best effort */
    }
  }

  /// The reason the most recent install attempt failed (e.g. blocked by Samsung
  /// Auto Blocker / Play Protect, a signature conflict, or low storage), or null
  /// if none is pending. Reading it clears it on the native side.
  Future<String?> installError() async {
    if (!supported) return null;
    try {
      final msg = await _native.invokeMethod<String>('installError');
      return (msg != null && msg.isNotEmpty) ? msg : null;
    } catch (_) {
      return null;
    }
  }

  // ---- Background download (system DownloadManager) ------------------------
  //
  // Unlike [download], which streams bytes inside the app's own isolate (and so
  // stalls the moment the app is backgrounded or killed), these hand the fetch
  // to Android's DownloadManager. It runs in the system process, shows its own
  // progress notification, retries across connectivity changes, and is still
  // there to be rejoined when the user returns — even after a cold start.

  /// The stable on-disk filename for [info]'s APK in the DownloadManager dir.
  String _fileNameFor(UpdateInfo info) =>
      'ping-${info.build.replaceAll('+', '-')}.apk';

  /// Start a background download of [info] and remember it. Returns the
  /// DownloadManager id, or null if it couldn't be enqueued.
  Future<int?> startBackgroundDownload(
    UpdateInfo info, {
    bool allowMetered = true,
  }) async {
    if (!supported) return null;
    try {
      final raw = await _native.invokeMethod<dynamic>('apkDownloadStart', {
        'url': info.downloadUrl,
        'fileName': _fileNameFor(info),
        'title': 'Ping ${info.version}',
        'allowMetered': allowMetered,
      });
      final id = raw is int ? raw : int.tryParse('${raw ?? ''}');
      if (id == null || id < 0) return null;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kPending,
        jsonEncode({
          'id': id,
          'build': info.build,
          'version': info.version,
          'sha256': info.sha256,
          'size': info.size,
        }),
      );
      return id;
    } catch (_) {
      return null;
    }
  }

  /// Current progress of background download [id].
  Future<ApkDownloadProgress> backgroundStatus(int id) async {
    if (!supported) return ApkDownloadProgress.none;
    try {
      final res =
          await _native.invokeMethod<dynamic>('apkDownloadStatus', {'id': id});
      if (res is! Map) return ApkDownloadProgress.none;
      return ApkDownloadProgress(
        state: apkStateFromString(res['status']?.toString()),
        bytes: (res['bytes'] as num?)?.toInt() ?? 0,
        total: (res['total'] as num?)?.toInt() ?? 0,
        reason: (res['reason'] as num?)?.toInt() ?? 0,
        path: res['path']?.toString(),
      );
    } catch (_) {
      return ApkDownloadProgress.none;
    }
  }

  /// A download from an earlier session that's still relevant to [info]. Stale
  /// records (a different build than the one now on offer) are dropped. Returns
  /// null when there's nothing to rejoin.
  Future<PendingApkDownload?> pendingDownload(UpdateInfo info) async {
    if (!supported) return null;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kPending);
      if (raw == null) return null;
      final j = jsonDecodeSafe(raw);
      final id = (j?['id'] as num?)?.toInt();
      final build = j?['build']?.toString();
      if (id == null || build == null) {
        await prefs.remove(_kPending);
        return null;
      }
      if (build != info.build) {
        // The user is now being offered a newer build than the one we were
        // fetching; the old download is irrelevant — cancel and forget it.
        await cancelBackground(id);
        return null;
      }
      return PendingApkDownload(id: id, build: build);
    } catch (_) {
      return null;
    }
  }

  /// Verify a *finished* download's bytes against the advertised size/sha256 and
  /// return its local path. Null when the file is missing or fails the check —
  /// the same integrity guarantee the in-process [download] gives.
  Future<String?> verifiedPath(
      ApkDownloadProgress status, UpdateInfo info) async {
    if (!supported) return null;
    final path = status.path;
    if (path == null) return null;
    try {
      final file = File(path);
      if (!await file.exists()) return null;
      if (info.size > 0 && await file.length() != info.size) return null;
      if (info.sha256.isNotEmpty && !await _matchesHash(file, info.sha256)) {
        return null;
      }
      return path;
    } catch (_) {
      return null;
    }
  }

  /// Hand a finished background download to the system package installer using a
  /// grantable content:// URI (more reliable than a raw path on newer Android).
  Future<bool> installBackground(int id) async {
    if (!supported) return false;
    try {
      final ok = await _native.invokeMethod<bool>('apkInstall', {'id': id});
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Abort an in-flight background download and forget it.
  Future<void> cancelBackground(int id) async {
    if (supported) {
      try {
        await _native.invokeMethod('apkDownloadCancel', {'id': id});
      } catch (_) {
        /* best effort */
      }
    }
    await clearPending();
  }

  /// Best-effort, fire-and-forget OTA funnel event (anonymous aggregate count on
  /// the server). Never throws and never blocks the update flow.
  Future<void> reportEvent(String baseUrl, String name) async {
    if (!supported) return;
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    try {
      await http
          .post(
            Uri.parse('$root/api/telemetry'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'app': 'android',
              'events': [
                {'name': name}
              ],
            }),
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      /* telemetry is best-effort */
    }
  }

  /// Forget the persisted pending-download record (without touching the file).
  Future<void> clearPending() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kPending);
    } catch (_) {
      /* best effort */
    }
  }
}
