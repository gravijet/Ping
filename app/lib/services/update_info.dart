import 'dart:convert';

/// Metadata for the newest published Android build, as returned by the server's
/// `/download/info` endpoint. Pure data — shared by the native updater and the
/// web/desktop stub.
class UpdateInfo {
  final String version; // marketing version, e.g. "0.2.0"
  final String build; // full build string, e.g. "0.2.0+5"
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

/// State of a background APK download handed to Android's DownloadManager.
/// Mirrors the system's own status codes so the UI can react precisely (e.g.
/// distinguish "paused, waiting for Wi-Fi" from "failed").
enum ApkDownloadState { none, pending, running, paused, successful, failed, unknown }

ApkDownloadState apkStateFromString(String? s) {
  switch (s) {
    case 'pending':
      return ApkDownloadState.pending;
    case 'running':
      return ApkDownloadState.running;
    case 'paused':
      return ApkDownloadState.paused;
    case 'successful':
      return ApkDownloadState.successful;
    case 'failed':
      return ApkDownloadState.failed;
    case 'none':
      return ApkDownloadState.none;
    default:
      return ApkDownloadState.unknown;
  }
}

/// A snapshot of an in-flight (or finished) background download. Pure data so it
/// can be shared by the native updater and the web stub.
class ApkDownloadProgress {
  final ApkDownloadState state;
  final int bytes; // downloaded so far
  final int total; // expected total (-1/0 until DownloadManager knows it)
  final int reason; // DownloadManager reason code on pause/failure
  final String? path; // local file path once finished

  const ApkDownloadProgress({
    required this.state,
    this.bytes = 0,
    this.total = 0,
    this.reason = 0,
    this.path,
  });

  static const none = ApkDownloadProgress(state: ApkDownloadState.none);

  /// Fraction complete in 0..1, or null when the total isn't known yet (so the
  /// UI can show an indeterminate bar instead of a misleading 0 %).
  double? get fraction =>
      total > 0 ? (bytes / total).clamp(0.0, 1.0) : null;

  bool get isActive =>
      state == ApkDownloadState.pending ||
      state == ApkDownloadState.running ||
      state == ApkDownloadState.paused;

  bool get isDone => state == ApkDownloadState.successful;
  bool get isFailed =>
      state == ApkDownloadState.failed || state == ApkDownloadState.none;
}

/// A persisted reference to a download started in a previous app session, so a
/// download that kept running while the app was backgrounded (or killed) can be
/// rejoined when the user comes back.
class PendingApkDownload {
  final int id; // DownloadManager id
  final String build; // the build this download is for, e.g. "0.23.0+28"

  const PendingApkDownload({required this.id, required this.build});
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

/// Returns true when semver [a] > [b] (e.g. "0.2.0" > "0.1.9").
bool semverGreater(String a, String b) {
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
