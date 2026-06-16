// dart:html is the right tool here: this file is only ever compiled for the web
// target (selected via the conditional export in platform_files.dart), and we
// build with dart2js (not wasm), where dart:html is fully supported.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';

// Web implementation: no real filesystem. Bytes become blob: object URLs (which
// Image.network / VideoPlayerController.networkUrl / audioplayers' UrlSource /
// package:http all accept), and "save to device" is a browser download.

String _blobUrl(List<int> bytes, String? mime) {
  final blob =
      html.Blob([Uint8List.fromList(bytes)], mime ?? 'application/octet-stream');
  return html.Url.createObjectUrlFromBlob(blob);
}

/// Return a blob: URL for [bytes] — playable/openable for the rest of the session.
Future<String?> writeTempBytes(String name, List<int> bytes) async =>
    _blobUrl(bytes, null);

/// On web a non-empty blob: URL is always usable.
bool localPathUsable(String path) => path.isNotEmpty;

/// Trigger a browser download of [bytes] as [name]. Returns [name] on success.
Future<String?> saveBytesToDevice(String name, List<int> bytes,
    {String? mime}) async {
  try {
    final url = _blobUrl(bytes, mime);
    html.AnchorElement(href: url)
      ..setAttribute('download', name)
      ..click();
    html.Url.revokeObjectUrl(url);
    return name;
  } catch (_) {
    return null;
  }
}

/// Read the bytes behind a blob:/http(s): [path]. Null on error.
Future<List<int>?> readLocalBytes(String path) async {
  try {
    final res = await http.get(Uri.parse(path));
    if (res.statusCode >= 200 && res.statusCode < 300) return res.bodyBytes;
    return null;
  } catch (_) {
    return null;
  }
}

/// The `record` plugin ignores the path on web (it records to memory and hands
/// back a blob: URL from stop()), so there's nothing to pre-allocate.
Future<String> recordTargetPath(String name) async => '';

/// Revoke a blob: URL so the browser can release it.
Future<void> deleteLocalFile(String path) async {
  try {
    if (path.startsWith('blob:')) html.Url.revokeObjectUrl(path);
  } catch (_) {
    /* best-effort */
  }
}

/// No private storage on web — the picked blob: URL is used directly. It lives
/// for the session; that's acceptable for a second-screen client.
Future<String> persistWallpaper(String sourcePath, String suffix) async =>
    sourcePath;

/// An image widget for a blob:/network [path].
Widget localFileImage(String path,
    {BoxFit fit = BoxFit.cover, Widget Function()? errorChild}) {
  return Image.network(
    path,
    fit: fit,
    errorBuilder: (_, _, _) => errorChild?.call() ?? const SizedBox.shrink(),
  );
}

/// A video controller for a blob:/network [path].
VideoPlayerController localFileVideoController(String path) =>
    VideoPlayerController.networkUrl(Uri.parse(path));
