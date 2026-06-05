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
        'phone': '+491701234567',
        'displayName': 'Lena Maier',
        'avatarColor': '#42A5F5',
      });
      expect(u.color, const Color(0xFF42A5F5));
      expect(u.initials, 'LM');
      expect(u.label, 'Lena Maier');
      expect(u.online, false);
    });

    test('falls back to the phone number when no name is set', () {
      final u = PingUser.fromJson({'id': '2', 'phone': '+491700000000'});
      expect(u.displayName, '+491700000000');
      expect(u.hasName, false);
      // No letters to use, so the avatar shows an icon instead of initials.
      expect(u.initials, '');
      expect(u.label, '+491700000000');
    });

    test('exposes avatar and backup-login flags', () {
      final u = PingUser.fromJson({
        'id': '3',
        'phone': '+491700000003',
        'displayName': 'Sam',
        'avatarColor': '#26A69A',
        'hasAvatar': true,
        'avatarVersion': 4,
        'email': 'sam@example.com',
        'hasPassword': true,
      });
      expect(u.hasAvatar, true);
      expect(u.avatarVersion, 4);
      expect(u.email, 'sam@example.com');
      expect(u.hasPassword, true);
      expect(u.initials, 'SA');
    });
  });

  group('ContactMatch', () {
    test('wraps the matched user and echoes the identifier', () {
      final m = ContactMatch.fromJson({
        'user': {
          'id': '9',
          'displayName': 'Mara',
          'avatarColor': '#7E57C2',
        },
        'phone': '+491701112233',
        'email': null,
      });
      expect(m.user.id, '9');
      expect(m.user.label, 'Mara');
      expect(m.phone, '+491701112233');
      expect(m.email, isNull);
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

    test('parses an inline quoted reply snapshot and copyWith keeps it', () {
      final m = Message.fromJson({
        'id': 'm9',
        'chatId': 'c1',
        'senderId': 'u2',
        'type': 'text',
        'body': 'Antwort',
        'createdAt': 3000,
        'replyTo': 'm1',
        'quoted': {
          'id': 'm1',
          'senderId': 'u1',
          'type': 'text',
          'deleted': false,
          'body': 'Originaltext',
        },
      });
      expect(m.replyTo, 'm1');
      expect(m.quoted, isNotNull);
      expect(m.quoted!.id, 'm1');
      expect(m.quoted!.senderId, 'u1');
      expect(m.quoted!.body, 'Originaltext');
      expect(m.quoted!.deleted, false);
      // The snapshot must survive a copyWith (e.g. a receipt status update).
      final updated = m.copyWith(status: MessageStatus.read);
      expect(updated.quoted?.body, 'Originaltext');
      expect(updated.replyTo, 'm1');
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
          'phone': '+491700000099',
          'displayName': 'Lena',
          'avatarColor': '#EF5350',
        },
        'unread': 3,
        'updatedAt': 5,
      });
      expect(c.isGroup, false);
      expect(c.otherUser?.phone, '+491700000099');
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
          {'id': 'a', 'phone': '+4911', 'displayName': 'A', 'avatarColor': '#AB47BC'},
        ],
        'updatedAt': 9,
      });
      expect(c.isGroup, true);
      expect(c.ownerId, 'a');
      expect(c.initials, 'CR');
    });
  });
}
