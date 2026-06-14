import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Metadata for the newest published Android build, as returned by the server's
/// `/download/info` endpoint.
class UpdateInfo {
  final String version; // marketing version, e.g. "2.2.0"
  final String build; // full build string, e.g. "2.2.0+5"
  final int? versionCode; // android version code (build number), e.g. 5
  final int size; // apk size in bytes
  final String sha256;
  final String downloadUrl; // absolute URL to the apk

  const UpdateInfo({
    required this.version,
    required this.build,
    required this.versionCode,
    required this.size,
    required this.sha256,
    required this.downloadUrl,
  });

  factory UpdateInfo.fromJson(Map<String, dynamic> j, String baseUrl) {
    final rel = (j['url'] as String?) ?? '/download';
    final root =
        baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return UpdateInfo(
      version: (j['version'] ?? '').toString(),
      build: (j['build'] ?? j['version'] ?? '').toString(),
      versionCode: j['versionCode'] is int
          ? j['versionCode'] as int
          : int.tryParse('${j['versionCode'] ?? ''}'),
      size: (j['size'] as num?)?.toInt() ?? 0,
      sha256: (j['sha256'] ?? '').toString(),
      downloadUrl: rel.startsWith('http') ? rel : '$root$rel',
    );
  }
}

/// Checks the server for a newer APK and, on demand, downloads and launches the
/// Android package installer. Android-only; no-ops elsewhere.
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

  /// The running app's version name, e.g. "2.1.0".
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
          return UpdateInfo(
            version: info.version,
            build: info.build,
            versionCode: info.versionCode,
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
    final byName = _semverGreater(info.version, await currentVersion());
    return byCode || byName;
  }

  /// Download the APK to a temp file, reporting progress in 0..1. Returns the
  /// file, or null on failure.
  Future<File?> download(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    if (!supported) return null;
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/ping-${info.build.replaceAll('+', '-')}.apk');
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
          final digest = await sha256.bind(file.openRead()).first;
          if (digest.toString().toLowerCase() != info.sha256.toLowerCase()) {
            try {
              await file.delete();
            } catch (_) {
              /* ignore */
            }
            return null;
          }
        }
        return file;
      } finally {
        client.close();
      }
    } catch (_) {
      return null;
    }
  }

  /// Open the downloaded APK so Android shows its package installer.
  Future<bool> install(File apk) async {
    if (!supported) return false;
    try {
      final result = await OpenFilex.open(
        apk.path,
        type: 'application/vnd.android.package-archive',
      );
      return result.type == ResultType.done;
    } catch (_) {
      return false;
    }
  }
}

/// JSON decode that never throws (returns null on bad input).
Map<String, dynamic>? jsonDecodeSafe(String body) {
  try {
    final v = body.isEmpty ? null : jsonDecode(body);
    return v is Map<String, dynamic> ? v : null;
  } catch (_) {
    return null;
  }
}

/// Returns true when semver [a] > [b] (e.g. "2.2.0" > "2.1.9").
bool _semverGreater(String a, String b) {
  List<int> parts(String v) => v
      .split('+')
      .first
      .split('.')
      .map((p) => int.tryParse(p.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0)
      .toList();
  final pa = parts(a), pb = parts(b);
  for (var i = 0; i < pa.length || i < pb.length; i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}
