import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// A message that was composed while offline and is waiting to be sent. It's
/// stored verbatim on disk so the optimistic bubble survives an app restart and
/// is replayed automatically the moment the connection comes back.
class OutboxEntry {
  /// The optimistic message id (a `tmp-…` value) — used to swap the pending
  /// bubble for the server-confirmed one once it's delivered.
  final String tempId;
  final String chatId;
  final String type; // 'text' or an attachment kind
  final String body;
  final Map<String, dynamic>? attachment;
  final String? replyTo;
  final int createdAt;

  const OutboxEntry({
    required this.tempId,
    required this.chatId,
    required this.type,
    required this.body,
    required this.createdAt,
    this.attachment,
    this.replyTo,
  });

  Map<String, dynamic> toJson() => {
        'tempId': tempId,
        'chatId': chatId,
        'type': type,
        'body': body,
        if (attachment != null) 'attachment': attachment,
        if (replyTo != null) 'replyTo': replyTo,
        'createdAt': createdAt,
      };

  factory OutboxEntry.fromJson(Map<String, dynamic> json) => OutboxEntry(
        tempId: json['tempId'] as String,
        chatId: json['chatId'] as String,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        attachment: (json['attachment'] as Map?)?.cast<String, dynamic>(),
        replyTo: json['replyTo'] as String?,
        createdAt: (json['createdAt'] ?? 0) as int,
      );
}

/// Durable FIFO queue of messages waiting to go out, persisted as a single JSON
/// file in the app's documents directory. All operations are best-effort: a
/// failed read or write simply behaves as an empty queue rather than throwing.
class OutboxStore {
  File? _file;

  Future<File> _f() async {
    if (_file != null) return _file!;
    final docs = await getApplicationDocumentsDirectory();
    _file = File('${docs.path}/outbox.json');
    return _file!;
  }

  Future<List<OutboxEntry>> load() async {
    try {
      final f = await _f();
      if (!await f.exists()) return [];
      final raw = jsonDecode(await f.readAsString()) as List;
      return raw
          .map((e) => OutboxEntry.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> save(List<OutboxEntry> entries) async {
    try {
      final f = await _f();
      await f.writeAsString(jsonEncode(entries.map((e) => e.toJson()).toList()));
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
