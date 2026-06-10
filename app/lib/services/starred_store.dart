import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/message.dart';

/// One bookmarked ("starred") message, together with a snapshot of the chat
/// title so the saved-messages screen can show where it came from even if the
/// chat is no longer in memory.
class StarredMessage {
  final Message message;
  final String chatTitle;
  final int starredAt;

  const StarredMessage({
    required this.message,
    required this.chatTitle,
    required this.starredAt,
  });

  Map<String, dynamic> toJson() => {
        'chatTitle': chatTitle,
        'starredAt': starredAt,
        'message': message.toJson(),
      };

  factory StarredMessage.fromJson(Map<String, dynamic> j) => StarredMessage(
        message: Message.fromJson(j['message'] as Map<String, dynamic>),
        chatTitle: (j['chatTitle'] ?? '') as String,
        starredAt: (j['starredAt'] ?? 0) as int,
      );
}

/// On-device store of bookmarked messages. Kept in a single JSON file in the
/// app documents directory; the message snapshots travel with the bookmark so
/// "Gespeichert" works offline and survives the server purging history.
class StarredStore {
  File? _file;

  Future<File> _resolve() async {
    if (_file != null) return _file!;
    final docs = await getApplicationDocumentsDirectory();
    _file = File('${docs.path}/starred.json');
    return _file!;
  }

  Future<List<StarredMessage>> load() async {
    try {
      final f = await _resolve();
      if (!await f.exists()) return [];
      final raw = jsonDecode(await f.readAsString()) as List;
      final list = raw
          .map((e) => StarredMessage.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => b.starredAt.compareTo(a.starredAt));
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<void> _save(List<StarredMessage> items) async {
    try {
      final f = await _resolve();
      await f.writeAsString(jsonEncode(items.map((e) => e.toJson()).toList()));
    } catch (_) {
      /* best-effort */
    }
  }

  /// Add or remove a bookmark; returns true when it is now starred.
  Future<bool> toggle(Message message, String chatTitle) async {
    final items = await load();
    final i = items.indexWhere((e) => e.message.id == message.id);
    if (i != -1) {
      items.removeAt(i);
      await _save(items);
      return false;
    }
    items.insert(
      0,
      StarredMessage(
        message: message,
        chatTitle: chatTitle,
        starredAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    await _save(items);
    return true;
  }

  Future<void> remove(String messageId) async {
    final items = await load()
      ..removeWhere((e) => e.message.id == messageId);
    await _save(items);
  }

  Future<Set<String>> ids() async =>
      (await load()).map((e) => e.message.id).toSet();

  Future<void> clearAll() async {
    try {
      final f = await _resolve();
      if (await f.exists()) await f.delete();
    } catch (_) {
      /* ignore */
    }
  }
}
