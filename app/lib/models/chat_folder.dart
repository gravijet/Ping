/// A user-defined chat folder (0.27.0 "Ordnung & Ausdruck"): a named, optionally
/// emoji-tagged grouping of conversations shown as filter chips above the chat
/// list. Folders live on the server and sync across the user's devices.
class ChatFolder {
  final String id;
  final String name;
  final String emoji;
  final int sort;
  final List<String> chatIds;

  const ChatFolder({
    required this.id,
    required this.name,
    this.emoji = '',
    this.sort = 0,
    this.chatIds = const [],
  });

  /// How many of the user's currently loaded chats land in this folder.
  bool contains(String chatId) => chatIds.contains(chatId);

  factory ChatFolder.fromJson(Map<String, dynamic> json) => ChatFolder(
        id: json['id'] as String,
        name: (json['name'] ?? '') as String,
        emoji: (json['emoji'] ?? '') as String,
        sort: (json['sort'] ?? 0) as int,
        chatIds:
            (json['chatIds'] as List?)?.map((e) => e as String).toList() ??
                const [],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'emoji': emoji,
        'sort': sort,
        'chatIds': chatIds,
      };
}
