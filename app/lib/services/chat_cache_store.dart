import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/chat.dart';

/// On-device snapshot of the chat list. It lets the home screen render instantly
/// on launch and — crucially — keeps working when the device is offline, before
/// (or without) a successful `/chats` fetch. Best-effort: any failure is treated
/// as "no snapshot".
class ChatCacheStore {
  File? _file;

  Future<File> _f() async {
    if (_file != null) return _file!;
    final docs = await getApplicationDocumentsDirectory();
    _file = File('${docs.path}/chats.json');
    return _file!;
  }

  Future<List<Chat>> load() async {
    try {
      final f = await _f();
      if (!await f.exists()) return [];
      final raw = jsonDecode(await f.readAsString()) as List;
      return raw.map((e) => Chat.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> save(List<Chat> chats) async {
    try {
      final f = await _f();
      await f.writeAsString(jsonEncode(chats.map((c) => c.toJson()).toList()));
    } catch (_) {
      /* best-effort */
    }
  }

  Future<void> clear() async {
    try {
      final f = await _f();
      if (await f.exists()) await f.delete();
    } catch (_) {
      /* ignore */
    }
  }
}
