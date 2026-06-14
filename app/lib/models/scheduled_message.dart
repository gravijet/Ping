import 'message.dart';

/// A message the user composed now but asked to send later. It lives on the
/// server until its [sendAt] passes, then is delivered into the chat normally.
class ScheduledMessage {
  final String id;
  final String chatId;
  final String type;
  final String body;
  final Attachment? attachment;
  final String? replyTo;
  final int sendAt;
  final int createdAt;

  const ScheduledMessage({
    required this.id,
    required this.chatId,
    required this.type,
    required this.body,
    required this.sendAt,
    required this.createdAt,
    this.attachment,
    this.replyTo,
  });

  DateTime get sendTime => DateTime.fromMillisecondsSinceEpoch(sendAt);

  String get preview {
    if (body.trim().isNotEmpty) return body.trim();
    switch (type) {
      case 'image':
        return '📷 Foto';
      case 'video':
        return '🎬 Video';
      case 'voice':
        return '🎤 Sprachnachricht';
      case 'audio':
        return '🎵 Audio';
      case 'gif':
        return 'GIF';
      case 'file':
        return '📎 Datei';
      default:
        return 'Anhang';
    }
  }

  factory ScheduledMessage.fromJson(Map<String, dynamic> json) => ScheduledMessage(
        id: json['id'] as String,
        chatId: json['chatId'] as String,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        attachment: json['attachment'] != null
            ? Attachment.fromJson(json['attachment'] as Map<String, dynamic>)
            : null,
        replyTo: json['replyTo'] as String?,
        sendAt: json['sendAt'] as int,
        createdAt: (json['createdAt'] ?? 0) as int,
      );
}
