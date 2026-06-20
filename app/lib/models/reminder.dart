/// A message reminder ("Erinnere mich"): the user asked Ping to nudge them about
/// a specific message at [remindAt]. The server fires it over the socket (and via
/// push when the app is closed) and stamps [firedAt]. A denormalised snapshot
/// (preview + chat title) lets the reminders screen render even if the original
/// message has since been deleted.
class Reminder {
  final String id;
  final String chatId;
  final String messageId;
  final String note;
  final String preview;
  final String chatTitle;
  final int remindAt;
  final int createdAt;
  final int? firedAt;

  const Reminder({
    required this.id,
    required this.chatId,
    required this.messageId,
    required this.remindAt,
    required this.createdAt,
    this.note = '',
    this.preview = '',
    this.chatTitle = '',
    this.firedAt,
  });

  bool get fired => firedAt != null;

  DateTime get remindTime => DateTime.fromMillisecondsSinceEpoch(remindAt);

  /// What to show as the reminder's main line.
  String get label {
    if (note.trim().isNotEmpty) return note.trim();
    if (preview.trim().isNotEmpty) return preview.trim();
    return 'Nachricht';
  }

  factory Reminder.fromJson(Map<String, dynamic> json) => Reminder(
        id: json['id'] as String,
        chatId: json['chatId'] as String,
        messageId: json['messageId'] as String,
        note: (json['note'] ?? '') as String,
        preview: (json['preview'] ?? '') as String,
        chatTitle: (json['chatTitle'] ?? '') as String,
        remindAt: json['remindAt'] as int,
        createdAt: (json['createdAt'] ?? 0) as int,
        firedAt: json['firedAt'] as int?,
      );
}
