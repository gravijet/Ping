import '../models/chat.dart';

/// How the chat list is ordered (Einstellungen → Chats → Sortierung). Stored in
/// settings as a short id string so it round-trips cleanly through JSON.
enum ChatSort { recent, unread, alphabetical }

extension ChatSortId on ChatSort {
  /// Stable id persisted in [PingSettings.chatSort].
  String get id => switch (this) {
        ChatSort.recent => 'recent',
        ChatSort.unread => 'unread',
        ChatSort.alphabetical => 'alpha',
      };

  String get label => switch (this) {
        ChatSort.recent => 'Neueste zuerst',
        ChatSort.unread => 'Ungelesene zuerst',
        ChatSort.alphabetical => 'Alphabetisch',
      };

  /// Parse a stored id back into a [ChatSort], defaulting to [ChatSort.recent].
  static ChatSort fromId(String? id) => switch (id) {
        'unread' => ChatSort.unread,
        'alpha' => ChatSort.alphabetical,
        _ => ChatSort.recent,
      };
}

/// The timestamp a chat is ordered by: its last message, or its own
/// `updatedAt` when there are no messages yet.
int chatActivity(Chat c) => c.lastMessage?.createdAt ?? c.updatedAt;

/// Compare two chats for the list, honouring the user's [sort] mode. The "note
/// to self" chat always floats to the very top, then pinned chats, then the
/// chosen ordering. Pure + total so it can be unit-tested and handed straight
/// to [List.sort].
int compareChats(
  Chat a,
  Chat b,
  ChatSort sort, {
  required bool Function(String chatId) isPinned,
}) {
  // "Note to self" first.
  if (a.self != b.self) return a.self ? -1 : 1;
  // Then pinned chats, above everything else.
  final ap = isPinned(a.id);
  final bp = isPinned(b.id);
  if (ap != bp) return ap ? -1 : 1;

  switch (sort) {
    case ChatSort.unread:
      // Unread chats first; within each group, fall back to recency.
      final au = a.unread > 0;
      final bu = b.unread > 0;
      if (au != bu) return au ? -1 : 1;
      return chatActivity(b).compareTo(chatActivity(a));
    case ChatSort.alphabetical:
      final cmp =
          a.displayTitle.toLowerCase().compareTo(b.displayTitle.toLowerCase());
      if (cmp != 0) return cmp;
      return chatActivity(b).compareTo(chatActivity(a));
    case ChatSort.recent:
      return chatActivity(b).compareTo(chatActivity(a));
  }
}

/// Return a new list of [chats] ordered for the given [sort]. Does not mutate
/// the input.
List<Chat> sortedChats(
  Iterable<Chat> chats,
  ChatSort sort, {
  required bool Function(String chatId) isPinned,
}) {
  final out = chats.toList();
  out.sort((a, b) => compareChats(a, b, sort, isPinned: isPinned));
  return out;
}
