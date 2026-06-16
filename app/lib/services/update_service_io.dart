import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'update_info.dart';

/// Checks the server for a newer APK and, on demand, downloads and launches the
/// Android package installer. Android-only; no-ops elsewhere. Public methods
/// hand back file *paths* (strings) so the shared UI never needs `dart:io`.
class UpdateService {
  static const _native = MethodChannel('ping/native');

  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

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
          // A per-ABI split carries its own (ABI-offset) version code. Comparing
          // *that* against the installed build number is what keeps same-version
          // hotfixes working for split-installed users — the universal build's
          // code would never look newer to them. Falls back to the universal
          // code when the server doesn't advertise a per-variant one.
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
  /// *either* the integer version code or the marketing version is higher — the
  /// version-name check keeps working even if a per-ABI split carries an
  /// inflated version code, so split-installed users still get updates.
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

  /// Open the downloaded APK at [path] so Android shows its package installer.
  Future<bool> install(String path) async {
    if (!supported) return false;
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
}
