// 0.27.0 "Ordnung & Ausdruck": model round-trips for pinned/starred messages,
// chat pin-count + synced draft, and the ChatFolder model + folder membership.
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/chat.dart';
import 'package:ping/models/chat_folder.dart';
import 'package:ping/models/message.dart';

void main() {
  group('Message pinned/starred', () {
    test('parses the pinned + starred flags', () {
      final m = Message.fromJson({
        'id': 'm1',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'hi',
        'createdAt': 1000,
        'pinned': true,
        'starred': true,
      });
      expect(m.pinned, isTrue);
      expect(m.starred, isTrue);
    });

    test('defaults both flags to false when absent', () {
      final m = Message.fromJson({
        'id': 'm2',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'hi',
        'createdAt': 1000,
      });
      expect(m.pinned, isFalse);
      expect(m.starred, isFalse);
    });

    test('round-trips the flags through toJson/fromJson', () {
      final m = Message(
        id: 'm3',
        chatId: 'c1',
        senderId: 'u1',
        type: 'text',
        body: 'hi',
        createdAt: 1,
        pinned: true,
        starred: true,
      );
      final back = Message.fromJson(m.toJson());
      expect(back.pinned, isTrue);
      expect(back.starred, isTrue);
    });

    test('copyWith preserves and overrides the flags', () {
      final m = Message(
        id: 'm4',
        chatId: 'c1',
        senderId: 'u1',
        type: 'text',
        body: 'hi',
        createdAt: 1,
        pinned: true,
      );
      expect(m.copyWith().pinned, isTrue); // preserved
      expect(m.copyWith(pinned: false).pinned, isFalse); // overridden
    });
  });

  group('Chat pinnedCount + draft', () {
    test('parses and round-trips the new fields', () {
      final c = Chat.fromJson({
        'id': 'c1',
        'type': 'direct',
        'title': 'Anna',
        'avatarColor': '#42A5F5',
        'memberIds': ['u1', 'u2'],
        'updatedAt': 5,
        'pinnedCount': 3,
        'draft': 'half a thought',
      });
      expect(c.pinnedCount, 3);
      expect(c.draft, 'half a thought');
      final back = Chat.fromJson(c.toJson());
      expect(back.pinnedCount, 3);
      expect(back.draft, 'half a thought');
    });

    test('an empty draft is omitted from toJson', () {
      final c = Chat(
        id: 'c2',
        type: 'direct',
        title: 'B',
        avatarColor: '#000000',
        memberIds: const [],
        updatedAt: 0,
      );
      expect(c.toJson().containsKey('draft'), isFalse);
      expect(c.pinnedCount, 0);
    });

    test('copyWith carries pinnedCount + draft across', () {
      final c = Chat(
        id: 'c3',
        type: 'direct',
        title: 'B',
        avatarColor: '#000000',
        memberIds: const [],
        updatedAt: 0,
        pinnedCount: 2,
        draft: 'd',
      );
      final renamed = c.copyWith(title: 'C');
      expect(renamed.pinnedCount, 2);
      expect(renamed.draft, 'd');
    });
  });

  group('ChatFolder', () {
    test('parses fields and chat membership', () {
      final f = ChatFolder.fromJson({
        'id': 'f1',
        'name': 'Arbeit',
        'emoji': '💼',
        'sort': 2,
        'chatIds': ['c1', 'c2'],
      });
      expect(f.name, 'Arbeit');
      expect(f.emoji, '💼');
      expect(f.sort, 2);
      expect(f.contains('c1'), isTrue);
      expect(f.contains('c9'), isFalse);
    });

    test('tolerates missing optional fields', () {
      final f = ChatFolder.fromJson({'id': 'f2', 'name': 'X'});
      expect(f.emoji, '');
      expect(f.chatIds, isEmpty);
    });
  });
}
