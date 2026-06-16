import 'dart:convert';

import '../models/message.dart';
import 'doc_store.dart';

/// On-device cache of chat messages. Every chat is stored under its own key so
/// conversations open instantly offline — and, crucially, so a user's own copy
/// survives even when the server purges messages after delivery (the "nur lokal"
/// storage mode). Temporary (optimistic) messages are never cached.
class LocalMessageStore {
  static const _maxPerChat = 400;

  // Chat ids are opaque server ids; keep the document name filesystem-safe.
  String _safe(String chatId) => chatId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
  String _name(String chatId) => 'messages/${_safe(chatId)}.json';

  /// Load a chat's cached messages (oldest first). Empty on any failure.
  Future<List<Message>> load(String chatId) async {
    final raw = await readDoc(_name(chatId));
    if (raw == null) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list
          .map((e) => Message.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Persist a chat's messages (keeps only the most recent [_maxPerChat], drops
  /// optimistic `tmp-` entries).
  Future<void> save(String chatId, List<Message> messages) async {
    final keep = messages.where((m) => !m.id.startsWith('tmp-')).toList();
    final trimmed = keep.length > _maxPerChat
        ? keep.sublist(keep.length - _maxPerChat)
        : keep;
    await writeDoc(
        _name(chatId), jsonEncode(trimmed.map((m) => m.toJson()).toList()));
  }

  Future<void> remove(String chatId) => deleteDoc(_name(chatId));

  /// Wipe the whole local cache (used on logout).
  Future<void> clearAll() => deletePrefix('messages');
}
