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
