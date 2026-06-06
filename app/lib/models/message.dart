import 'user.dart';

/// Delivery state of a message the current user sent.
enum MessageStatus { sending, sent, delivered, read, failed }

/// One recipient's delivery/read state for a message — used by the "message
/// info" sheet (long-press → Info).
class MessageReceiptInfo {
  final PingUser user;
  final int? deliveredAt;
  final int? readAt;

  const MessageReceiptInfo({required this.user, this.deliveredAt, this.readAt});

  bool get read => readAt != null;
  bool get delivered => deliveredAt != null;

  factory MessageReceiptInfo.fromJson(Map<String, dynamic> json) =>
      MessageReceiptInfo(
        user: PingUser.fromJson(json['user'] as Map<String, dynamic>),
        deliveredAt: json['deliveredAt'] as int?,
        readAt: json['readAt'] as int?,
      );
}

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

/// A media attachment carried by a message (or a status). The [url] is always a
/// server-relative path like `/api/uploads/<id>`; the app prefixes the base URL.
class Attachment {
  final String kind; // image | gif | video | audio | voice | file
  final String url;
  final String? mime;
  final String? name;
  final int? size;
  final int? width;
  final int? height;
  final int? durationMs;

  const Attachment({
    required this.kind,
    required this.url,
    this.mime,
    this.name,
    this.size,
    this.width,
    this.height,
    this.durationMs,
  });

  bool get isImage => kind == 'image' || kind == 'gif';
  bool get isVisual => kind == 'image' || kind == 'gif' || kind == 'video';
  bool get isAudio => kind == 'audio' || kind == 'voice';
  bool get isVoice => kind == 'voice';

  factory Attachment.fromJson(Map<String, dynamic> json) => Attachment(
        kind: (json['kind'] ?? 'file') as String,
        url: (json['url'] ?? '') as String,
        mime: json['mime'] as String?,
        name: json['name'] as String?,
        size: json['size'] as int?,
        width: json['width'] as int?,
        height: json['height'] as int?,
        durationMs: json['durationMs'] as int?,
      );

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'url': url,
        if (mime != null) 'mime': mime,
        if (name != null) 'name': name,
        if (size != null) 'size': size,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (durationMs != null) 'durationMs': durationMs,
      };
}

class Message {
  final String id;
  final String chatId;
  final String? senderId;
  final String type; // text | system | image | gif | video | audio | voice | file
  final String body;
  final Attachment? attachment;
  final String? replyTo;
  final int createdAt;
  final int? editedAt;
  final bool deleted;
  MessageStatus? status; // only meaningful for messages I sent

  /// A lightweight snapshot of the message this one replies to, supplied by the
  /// server so the quote always renders — even when the original is outside the
  /// loaded window. Null when this isn't a reply.
  final Message? quoted;

  Message({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.body,
    required this.createdAt,
    this.attachment,
    this.replyTo,
    this.editedAt,
    this.deleted = false,
    this.status,
    this.quoted,
  });

  bool get isSystem => type == 'system';
  bool get isEdited => editedAt != null && !deleted;
  bool get isMedia => type != 'text' && type != 'system';

  DateTime get time => DateTime.fromMillisecondsSinceEpoch(createdAt);

  /// A short label for the chat list / reply preview when there's no text.
  String get preview {
    if (deleted) return 'Diese Nachricht wurde gelöscht';
    if (body.trim().isNotEmpty) return body;
    switch (type) {
      case 'image':
        return '📷 Foto';
      case 'gif':
        return 'GIF';
      case 'video':
        return '🎬 Video';
      case 'voice':
        return '🎤 Sprachnachricht';
      case 'audio':
        return '🎵 Audio';
      case 'file':
        return '📎 ${attachment?.name ?? 'Datei'}';
      default:
        return body;
    }
  }

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
        attachment: attachment,
        replyTo: replyTo,
        createdAt: createdAt,
        editedAt: editedAt ?? this.editedAt,
        deleted: deleted ?? this.deleted,
        status: status ?? this.status,
        quoted: quoted,
      );

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        chatId: json['chatId'] as String,
        senderId: json['senderId'] as String?,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        attachment: json['attachment'] != null
            ? Attachment.fromJson(json['attachment'] as Map<String, dynamic>)
            : null,
        replyTo: json['replyTo'] as String?,
        createdAt: json['createdAt'] as int,
        editedAt: json['editedAt'] as int?,
        deleted: (json['deleted'] ?? false) as bool,
        status: json['status'] != null
            ? statusFromString(json['status'] as String)
            : null,
        quoted: json['quoted'] != null
            ? Message._fromQuoted(
                json['quoted'] as Map<String, dynamic>,
                json['chatId'] as String,
              )
            : null,
      );

  /// Builds a partial message from a server-supplied quoted snapshot. Only the
  /// fields the reply preview needs (sender, type, body, deleted) are populated.
  factory Message._fromQuoted(Map<String, dynamic> json, String chatId) =>
      Message(
        id: json['id'] as String,
        chatId: chatId,
        senderId: json['senderId'] as String?,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        createdAt: 0,
        deleted: (json['deleted'] ?? false) as bool,
      );
}
