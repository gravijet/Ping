import 'package:http/http.dart' as http;

import 'platform_files.dart';

/// Downloads auth-gated attachments so audio can be played and files opened or
/// saved, keeping a small in-memory cache keyed by URL. The actual file handling
/// lives in [platform_files] (real files on native, blob: URLs / browser
/// downloads on web).
class MediaService {
  final Map<String, String> _cache = {}; // full url -> local path / blob url

  String _fileName(String url, String? suggested) {
    final id = Uri.parse(url).pathSegments.isNotEmpty
        ? Uri.parse(url).pathSegments.last
        : DateTime.now().millisecondsSinceEpoch.toString();
    var ext = '';
    if (suggested != null && suggested.contains('.')) {
      ext = suggested.substring(suggested.lastIndexOf('.'));
      // Keep it short and safe.
      if (ext.length > 8) ext = '';
    }
    return '$id$ext';
  }

  /// Returns a playable path/URL for [url], downloading it (with [headers]) on
  /// first use. Null on failure. On native this is a temp file path; on web a
  /// blob: URL.
  Future<String?> cacheToFile(
    String url,
    Map<String, String> headers, {
    String? suggestedName,
  }) async {
    final cached = _cache[url];
    if (cached != null && localPathUsable(cached)) return cached;
    try {
      final res = await http
          .get(Uri.parse(url), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (res.statusCode != 200) return null;
      final path =
          await writeTempBytes(_fileName(url, suggestedName), res.bodyBytes);
      if (path != null) _cache[url] = path;
      return path;
    } catch (_) {
      return null;
    }
  }

  /// Saves [url] to the device (downloads folder on native, a browser download
  /// on web) and returns the saved path/name (or null on failure).
  Future<String?> saveToDevice(
    String url,
    Map<String, String> headers, {
    String? suggestedName,
  }) async {
    try {
      final res = await http
          .get(Uri.parse(url), headers: headers)
          .timeout(const Duration(seconds: 60));
      if (res.statusCode != 200) return null;
      final name = suggestedName?.trim().isNotEmpty == true
          ? suggestedName!.replaceAll(RegExp(r'[\\/]'), '_')
          : _fileName(url, suggestedName);
      return await saveBytesToDevice(name, res.bodyBytes,
          mime: res.headers['content-type']);
    } catch (_) {
      return null;
    }
  }
}
