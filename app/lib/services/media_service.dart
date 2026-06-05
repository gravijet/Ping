import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Downloads auth-gated attachments to local files (so audio can be played and
/// files opened/saved) and keeps a small in-memory cache keyed by URL.
class MediaService {
  final Map<String, String> _cache = {}; // full url -> local path

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

  /// Returns a local path for [url], downloading it (with [headers]) on first
  /// use. Null on failure.
  Future<String?> cacheToFile(
    String url,
    Map<String, String> headers, {
    String? suggestedName,
  }) async {
    final cached = _cache[url];
    if (cached != null && File(cached).existsSync()) return cached;
    try {
      final res = await http
          .get(Uri.parse(url), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (res.statusCode != 200) return null;
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/${_fileName(url, suggestedName)}';
      await File(path).writeAsBytes(res.bodyBytes);
      _cache[url] = path;
      return path;
    } catch (_) {
      return null;
    }
  }

  /// Saves [url] into the app's documents directory under its original name and
  /// returns the saved path (or null on failure).
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
      final dir =
          await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
      final name = suggestedName?.trim().isNotEmpty == true
          ? suggestedName!.replaceAll(RegExp(r'[\\/]'), '_')
          : _fileName(url, suggestedName);
      final path = '${dir.path}/$name';
      await File(path).writeAsBytes(res.bodyBytes);
      return path;
    } catch (_) {
      return null;
    }
  }
}
