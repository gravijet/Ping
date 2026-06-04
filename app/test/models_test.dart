import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/chat.dart';
import 'package:ping/models/message.dart';
import 'package:ping/models/user.dart';

void main() {
  group('PingUser', () {
    test('parses colour and builds initials from two names', () {
      final u = PingUser.fromJson({
        'id': '1',
        'username': 'lena_92',
        'displayName': 'Lena Maier',
        'avatarColor': '#42A5F5',
      });
      expect(u.color, const Color(0xFF42A5F5));
      expect(u.initials, 'LM');
      expect(u.online, false);
    });

    test('falls back to username when display name missing', () {
      final u = PingUser.fromJson({'id': '2', 'username': 'bob'});
      expect(u.displayName, 'bob');
      expect(u.initials, 'BO');
    });
  });

  group('Message', () {
    test('round-trips status and edited flag', () {
      final m = Message.fromJson({
        'id': 'm1',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'hi',
        'createdAt': 1000,
        'editedAt': 2000,
        'status': 'read',
      });
      expect(m.status, MessageStatus.read);
      expect(m.isEdited, true);
      expect(m.isSystem, false);
    });

    test('deleted message reports no edit', () {
      final m = Message.fromJson({
        'id': 'm2',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': '',
        'createdAt': 1000,
        'editedAt': 2000,
        'deleted': true,
      });
      expect(m.deleted, true);
      expect(m.isEdited, false);
    });
  });

  group('Chat', () {
    test('direct chat exposes the other user', () {
      final c = Chat.fromJson({
        'id': 'c1',
        'type': 'direct',
        'title': 'Lena',
        'avatarColor': '#EF5350',
        'memberIds': ['a', 'b'],
        'otherUser': {
          'id': 'b',
          'username': 'lena',
          'displayName': 'Lena',
          'avatarColor': '#EF5350',
        },
        'unread': 3,
        'updatedAt': 5,
      });
      expect(c.isGroup, false);
      expect(c.otherUser?.username, 'lena');
      expect(c.unread, 3);
    });

    test('group chat carries members and owner', () {
      final c = Chat.fromJson({
        'id': 'g1',
        'type': 'group',
        'title': 'Crew',
        'avatarColor': '#AB47BC',
        'memberIds': ['a', 'b', 'c'],
        'ownerId': 'a',
        'members': [
          {'id': 'a', 'username': 'a', 'displayName': 'A', 'avatarColor': '#AB47BC'},
        ],
        'updatedAt': 9,
      });
      expect(c.isGroup, true);
      expect(c.ownerId, 'a');
      expect(c.initials, 'CR');
    });
  });
}
