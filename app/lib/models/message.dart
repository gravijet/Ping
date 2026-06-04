/// Delivery state of a message the current user sent.
enum MessageStatus { sending, sent, delivered, read, failed }

MessageStatus statusFromString(String? s) {
  switch (s) {
    case 'sent':
      return MessageStatus.sent;
    case 'delivered':
      return MessageStatus.delivered;
    case 'read':
      return MessageStatus.read;
    default:
      return MessageStatus.sent;
  }
}

class Message {
  final String id;
  final String chatId;
  final String? senderId;
  final String type; // 'text' | 'system'
  final String body;
  final String? replyTo;
  final int createdAt;
  final int? editedAt;
  final bool deleted;
  MessageStatus? status; // only meaningful for messages I sent

  Message({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.body,
    required this.createdAt,
    this.replyTo,
    this.editedAt,
    this.deleted = false,
    this.status,
  });

  bool get isSystem => type == 'system';
  bool get isEdited => editedAt != null && !deleted;

  DateTime get time => DateTime.fromMillisecondsSinceEpoch(createdAt);

  Message copyWith({
    String? body,
    int? editedAt,
    bool? deleted,
    MessageStatus? status,
  }) =>
      Message(
        id: id,
        chatId: chatId,
        senderId: senderId,
        type: type,
        body: body ?? this.body,
        replyTo: replyTo,
        createdAt: createdAt,
        editedAt: editedAt ?? this.editedAt,
        deleted: deleted ?? this.deleted,
        status: status ?? this.status,
      );

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        chatId: json['chatId'] as String,
        senderId: json['senderId'] as String?,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        replyTo: json['replyTo'] as String?,
        createdAt: json['createdAt'] as int,
        editedAt: json['editedAt'] as int?,
        deleted: (json['deleted'] ?? false) as bool,
        status: json['status'] != null
            ? statusFromString(json['status'] as String)
            : null,
      );
}
