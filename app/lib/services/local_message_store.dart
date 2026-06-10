import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/message.dart';

/// On-device cache of chat messages. Every chat is written to its own JSON file
/// so conversations open instantly offline — and, crucially, so a user's own
/// copy survives even when the server purges messages after delivery (the
/// "nur lokal" storage mode). Temporary (optimistic) messages are never cached.
class LocalMessageStore {
  Directory? _dir;
  static const _maxPerChat = 400;

  Future<Directory> _directory() async {
    if (_dir != null) return _dir!;
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/messages');
    if (!await dir.exists()) await dir.create(recursive: true);
    _dir = dir;
    return dir;
  }

  // Chat ids are opaque server ids; keep the filename filesystem-safe anyway.
  String _safe(String chatId) => chatId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  Future<File> _file(String chatId) async =>
      File('${(await _directory()).path}/${_safe(chatId)}.json');

  /// Load a chat's cached messages (oldest first). Empty on any failure.
  Future<List<Message>> load(String chatId) async {
    try {
      final f = await _file(chatId);
      if (!await f.exists()) return [];
      final raw = jsonDecode(await f.readAsString()) as List;
      return raw
          .map((e) => Message.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Persist a chat's messages (keeps only the most recent [_maxPerChat], drops
  /// optimistic `tmp-` entries).
  Future<void> save(String chatId, List<Message> messages) async {
    try {
      final keep = messages.where((m) => !m.id.startsWith('tmp-')).toList();
      final trimmed = keep.length > _maxPerChat
          ? keep.sublist(keep.length - _maxPerChat)
          : keep;
      final f = await _file(chatId);
      await f.writeAsString(jsonEncode(trimmed.map((m) => m.toJson()).toList()));
    } catch (_) {
      /* caching is best-effort */
    }
  }

  Future<void> remove(String chatId) async {
    try {
      final f = await _file(chatId);
      if (await f.exists()) await f.delete();
    } catch (_) {
      /* ignore */
    }
  }

  /// Wipe the whole local cache (used on logout).
  Future<void> clearAll() async {
    try {
      final dir = await _directory();
      if (await dir.exists()) await dir.delete(recursive: true);
      _dir = null;
    } catch (_) {
      /* ignore */
    }
  }
}
