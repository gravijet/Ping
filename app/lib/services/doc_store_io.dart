import 'dart:io';

import 'package:path_provider/path_provider.dart';

// Native implementation: JSON documents under the app documents directory.

Future<File> _file(String name) async {
  final docs = await getApplicationDocumentsDirectory();
  return File('${docs.path}/$name');
}

Future<String?> readDoc(String name) async {
  try {
    final f = await _file(name);
    if (!await f.exists()) return null;
    return await f.readAsString();
  } catch (_) {
    return null;
  }
}

Future<void> writeDoc(String name, String contents) async {
  try {
    final f = await _file(name);
    // `name` may carry a sub-folder (e.g. messages/<id>.json) — make sure it
    // exists before writing.
    await f.parent.create(recursive: true);
    await f.writeAsString(contents);
  } catch (_) {
    /* best-effort */
  }
}

Future<void> deleteDoc(String name) async {
  try {
    final f = await _file(name);
    if (await f.exists()) await f.delete();
  } catch (_) {
    /* ignore */
  }
}

/// Delete everything under the sub-folder [prefix] (e.g. the whole `messages`
/// cache on logout).
Future<void> deletePrefix(String prefix) async {
  try {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/$prefix');
    if (await dir.exists()) await dir.delete(recursive: true);
  } catch (_) {
    /* ignore */
  }
}
