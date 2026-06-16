import 'dart:convert';

import '../models/chat.dart';
import 'doc_store.dart';

/// On-device snapshot of the chat list. It lets the home screen render instantly
/// on launch and — crucially — keeps working when the device is offline, before
/// (or without) a successful `/chats` fetch. Best-effort: any failure is treated
/// as "no snapshot".
class ChatCacheStore {
  static const _name = 'chats.json';

  Future<List<Chat>> load() async {
    final raw = await readDoc(_name);
    if (raw == null) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Chat.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> save(List<Chat> chats) =>
      writeDoc(_name, jsonEncode(chats.map((c) => c.toJson()).toList()));

  Future<void> clear() => deleteDoc(_name);
}
