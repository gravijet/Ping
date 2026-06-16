import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

// Native implementation: real files under the temp / downloads / documents dirs.

String _safe(String name) => name.replaceAll(RegExp(r'[\\/]'), '_');

/// Write [bytes] to a temp file named [name] and return its path (null on error).
Future<String?> writeTempBytes(String name, List<int> bytes) async {
  try {
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/${_safe(name)}';
    await File(path).writeAsBytes(bytes);
    return path;
  } catch (_) {
    return null;
  }
}

/// Whether [path] still points at usable bytes (a present file on native).
bool localPathUsable(String path) {
  try {
    return path.isNotEmpty && File(path).existsSync();
  } catch (_) {
    return false;
  }
}

/// Save [bytes] into the device's downloads (or documents) directory and return
/// the saved path (null on error).
Future<String?> saveBytesToDevice(String name, List<int> bytes,
    {String? mime}) async {
  try {
    final dir = await getDownloadsDirectory() ??
        await getApplicationDocumentsDirectory();
    final path = '${dir.path}/${_safe(name)}';
    await File(path).writeAsBytes(bytes);
    return path;
  } catch (_) {
    return null;
  }
}

/// Read the bytes at [path] (a local file). Null on error.
Future<List<int>?> readLocalBytes(String path) async {
  try {
    return await File(path).readAsBytes();
  } catch (_) {
    return null;
  }
}

/// A temp-file path to record into (the `record` plugin writes here on native).
Future<String> recordTargetPath(String name) async {
  final dir = await getTemporaryDirectory();
  return '${dir.path}/${_safe(name)}';
}

/// Best-effort delete of a local file.
Future<void> deleteLocalFile(String path) async {
  if (path.isEmpty) return;
  try {
    final f = File(path);
    if (await f.exists()) await f.delete();
  } catch (_) {
    /* best-effort */
  }
}

/// Copy a picked wallpaper [sourcePath] into the app's private storage so it
/// survives the original being moved/deleted, returning the stored path.
Future<String> persistWallpaper(String sourcePath, String suffix) async {
  final docs = await getApplicationDocumentsDirectory();
  final dir = Directory('${docs.path}/wallpapers');
  if (!await dir.exists()) await dir.create(recursive: true);
  final ext = sourcePath.contains('.')
      ? sourcePath.substring(sourcePath.lastIndexOf('.'))
      : suffix;
  final dest = '${dir.path}/wp_${DateTime.now().millisecondsSinceEpoch}$ext';
  await File(sourcePath).copy(dest);
  return dest;
}

/// An image widget for a local-file [path].
Widget localFileImage(String path,
    {BoxFit fit = BoxFit.cover, Widget Function()? errorChild}) {
  return Image.file(
    File(path),
    fit: fit,
    errorBuilder: (_, _, _) => errorChild?.call() ?? const SizedBox.shrink(),
  );
}

/// A video controller for a local-file [path].
VideoPlayerController localFileVideoController(String path) =>
    VideoPlayerController.file(File(path));
