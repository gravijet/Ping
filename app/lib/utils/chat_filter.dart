import '../models/chat.dart';

/// The quick filters shown above the chat list. Pure data + a pure predicate so
/// the filtering logic can be unit-tested without a widget tree.
enum ChatFilter { all, unread, favorites, groups }

extension ChatFilterLabel on ChatFilter {
  String get label => switch (this) {
        ChatFilter.all => 'Alle',
        ChatFilter.unread => 'Ungelesen',
        ChatFilter.favorites => 'Favoriten',
        ChatFilter.groups => 'Gruppen',
      };
}

/// Whether [chat] belongs in the given [filter]. [isFavorite] is supplied by the
/// caller because favourites live in device-local state, not on the chat itself.
bool chatMatchesFilter(
  Chat chat,
  ChatFilter filter, {
  required bool isFavorite,
}) {
  switch (filter) {
    case ChatFilter.all:
      return true;
    case ChatFilter.unread:
      return chat.unread > 0;
    case ChatFilter.favorites:
      return isFavorite;
    case ChatFilter.groups:
      return chat.isGroup;
  }
}

/// Apply a [filter] to a list of [chats], preserving order.
List<Chat> applyChatFilter(
  Iterable<Chat> chats,
  ChatFilter filter, {
  required bool Function(String chatId) isFavorite,
}) =>
    chats
        .where((c) => chatMatchesFilter(c, filter, isFavorite: isFavorite(c.id)))
        .toList();
