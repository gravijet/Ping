import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/chat.dart';
import 'package:ping/models/message.dart';
import 'package:ping/models/reminder.dart';
import 'package:ping/models/remote_config.dart';
import 'package:ping/models/status.dart';
import 'package:ping/models/user.dart';
import 'package:ping/services/outbox_store.dart';
import 'package:ping/utils/message_format.dart';

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

    test('parses trust badge flags and defaults them to false', () {
      final plain = PingUser.fromJson({
        'id': '4',
        'phone': '+491700000004',
        'displayName': 'Plain',
        'avatarColor': '#26A69A',
      });
      expect(plain.official, false);
      expect(plain.verified, false);
      expect(plain.premium, false);
      expect(plain.hasBadge, false);

      final team = PingUser.fromJson({
        'id': 'ping-official',
        'displayName': 'Ping Team',
        'avatarColor': '#5C6BC0',
        'official': true,
        'verified': false,
        'premium': false,
      });
      expect(team.official, true);
      expect(team.hasBadge, true);
      // copyWith preserves the flags.
      expect(team.copyWith(displayName: 'X').official, true);

      final premium = PingUser.fromJson({
        'id': '5',
        'phone': '+491700000005',
        'displayName': 'Gold',
        'avatarColor': '#FFB300',
        'premium': true,
      });
      expect(premium.premium, true);
      expect(premium.hasBadge, true);
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

    test('expire timer round-trips from json', () {
      final c = Chat.fromJson({
        'id': 'c2',
        'type': 'direct',
        'title': 'T',
        'avatarColor': '#5C6BC0',
        'memberIds': ['a', 'b'],
        'expireSeconds': 86400,
        'updatedAt': 1,
      });
      expect(c.expireSeconds, 86400);
      expect(c.copyWith(unread: 1).expireSeconds, 86400);
    });
  });

  group('Poll', () {
    test('poll message parses options, votes and preview', () {
      final m = Message.fromJson({
        'id': 'p1',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'poll',
        'body': '',
        'createdAt': 1000,
        'poll': {
          'question': 'Pizza?',
          'multi': true,
          'options': [
            {'text': 'Ja', 'votes': 2},
            {'text': 'Nein', 'votes': 0},
          ],
          'myVotes': [0],
          'totalVoters': 2,
        },
      });
      expect(m.poll, isNotNull);
      expect(m.poll!.question, 'Pizza?');
      expect(m.poll!.multi, true);
      expect(m.poll!.options.length, 2);
      expect(m.poll!.options.first.votes, 2);
      expect(m.poll!.myVotes, [0]);
      expect(m.poll!.totalVotes, 2);
      expect(m.preview, '📊 Pizza?');
      // Local-cache round trip keeps the poll payload.
      final back = Message.fromJson(m.toJson());
      expect(back.poll!.question, 'Pizza?');
      expect(back.poll!.options[0].votes, 2);
    });
  });

  group('Disappearing messages', () {
    test('expiresAt round-trips and isExpired flips', () {
      final future = DateTime.now().millisecondsSinceEpoch + 60000;
      final m = Message.fromJson({
        'id': 'e1',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'bald weg',
        'createdAt': 1000,
        'expiresAt': future,
      });
      expect(m.expiresAt, future);
      expect(m.isExpired, false);
      final expired = Message.fromJson({
        ...m.toJson(),
        'expiresAt': DateTime.now().millisecondsSinceEpoch - 1000,
      });
      expect(expired.isExpired, true);
    });
  });

  group('StatusGroup', () {
    PingStatus item(String id, {required bool seen}) => PingStatus(
          id: id,
          userId: 'u1',
          type: 'text',
          body: id,
          createdAt: 0,
          expiresAt: 0,
          seen: seen,
        );

    StatusGroup groupWith(List<PingStatus> items) => StatusGroup(
          user: const PingUser(
              id: 'u1', phone: '+1', displayName: 'A', avatarColor: '#0A84FF'),
          items: items,
          hasUnseen: items.any((s) => !s.seen),
          updatedAt: 0,
        );

    test('firstUnseen skips already-seen statuses', () {
      final g = groupWith([
        item('a', seen: true),
        item('b', seen: true),
        item('c', seen: false),
      ]);
      // Re-opening jumps past the two watched items straight to the new one.
      expect(g.firstUnseen, 2);
    });

    test('firstUnseen replays from the start when everything is seen', () {
      final g = groupWith([item('a', seen: true), item('b', seen: true)]);
      expect(g.firstUnseen, 0);
    });

    test('marking an item seen clears hasUnseen once nothing is left', () {
      var g = groupWith([item('a', seen: true), item('b', seen: false)]);
      expect(g.hasUnseen, true);
      final items = [g.items[0], g.items[1].copyWith(seen: true)];
      g = g.copyWith(items: items, hasUnseen: items.any((s) => !s.seen));
      expect(g.hasUnseen, false);
      expect(g.firstUnseen, 0);
    });
  });

  group('Offline cache serialisation', () {
    test('PingUser round-trips through toJson/fromJson', () {
      final u = PingUser.fromJson({
        'id': 'u1',
        'phone': '+431',
        'displayName': 'Mara',
        'avatarColor': '#FF8800',
        'about': 'hi',
        'hasAvatar': true,
        'avatarVersion': 3,
        'isAdmin': true,
        'premium': true,
        'messageStorage': 'local',
        'showLastSeen': false,
      });
      final back = PingUser.fromJson(
          jsonDecode(jsonEncode(u.toJson())) as Map<String, dynamic>);
      expect(back.id, 'u1');
      expect(back.displayName, 'Mara');
      expect(back.avatarColor, '#FF8800');
      expect(back.hasAvatar, true);
      expect(back.avatarVersion, 3);
      expect(back.isAdmin, true);
      expect(back.premium, true);
      expect(back.messageStorage, 'local');
      expect(back.showLastSeen, false);
    });

    test('Chat round-trips with otherUser + lastMessage', () {
      final c = Chat.fromJson({
        'id': 'c1',
        'type': 'direct',
        'title': 'Mara',
        'avatarColor': '#0A84FF',
        'memberIds': ['me', 'u1'],
        'otherUser': {
          'id': 'u1',
          'phone': '+431',
          'displayName': 'Mara',
          'avatarColor': '#0A84FF',
        },
        'lastMessage': {
          'id': 'm1',
          'chatId': 'c1',
          'senderId': 'u1',
          'type': 'text',
          'body': 'hey',
          'createdAt': 5,
        },
        'unread': 2,
        'muted': true,
        'archived': true,
        'expireSeconds': 3600,
        'updatedAt': 9,
      });
      final back = Chat.fromJson(
          jsonDecode(jsonEncode(c.toJson())) as Map<String, dynamic>);
      expect(back.id, 'c1');
      expect(back.otherUser?.displayName, 'Mara');
      expect(back.lastMessage?.body, 'hey');
      expect(back.unread, 2);
      expect(back.muted, true);
      expect(back.archived, true);
      expect(back.expireSeconds, 3600);
      expect(back.memberIds, ['me', 'u1']);
    });

    test('RemoteConfig parses flags/values/notice and round-trips', () {
      final c = RemoteConfig.fromJson({
        'flags': {'polls': true, 'calls': false},
        'values': {'maxStatusSeconds': 45, 'inviteUrl': 'https://x'},
        'notice': {'text': 'Wartung', 'level': 'warning'},
        'minSupportedBuild': 12,
      });
      expect(c.flag('polls'), true);
      expect(c.flag('calls'), false);
      expect(c.flag('unknown', fallback: true), true); // unknown → fallback
      expect(c.intValue('maxStatusSeconds', 30), 45);
      expect(c.stringValue('inviteUrl'), 'https://x');
      expect(c.notice?.level, 'warning');
      expect(c.minSupportedBuild, 12);

      final back = RemoteConfig.decode(c.encode());
      expect(back.flag('polls'), true);
      expect(back.intValue('maxStatusSeconds', 0), 45);
      expect(back.notice?.text, 'Wartung');
      expect(back.minSupportedBuild, 12);
    });

    test('RemoteConfig.decode tolerates garbage and empty', () {
      expect(RemoteConfig.decode(null).flag('x', fallback: true), true);
      expect(RemoteConfig.decode('not json').minSupportedBuild, 0);
      expect(RemoteConfig.decode('').notice, isNull);
    });

    test('OutboxEntry round-trips and preserves replyTo + attachment', () {
      const e = OutboxEntry(
        tempId: 'tmp-1',
        chatId: 'c1',
        type: 'image',
        body: 'caption',
        createdAt: 42,
        replyTo: 'm0',
        attachment: {'kind': 'image', 'url': '/api/uploads/x'},
      );
      final back = OutboxEntry.fromJson(
          jsonDecode(jsonEncode(e.toJson())) as Map<String, dynamic>);
      expect(back.tempId, 'tmp-1');
      expect(back.chatId, 'c1');
      expect(back.type, 'image');
      expect(back.body, 'caption');
      expect(back.replyTo, 'm0');
      expect(back.createdAt, 42);
      expect(back.attachment?['url'], '/api/uploads/x');
    });
  });

  group('Message formatting', () {
    test('parses bold/italic/strike/code and keeps the text intact', () {
      final runs = parseMessageFormat('a *b* _c_ ~d~ `e`');
      expect(runs.firstWhere((r) => r.bold).text, 'b');
      expect(runs.firstWhere((r) => r.italic).text, 'c');
      expect(runs.firstWhere((r) => r.strike).text, 'd');
      expect(runs.firstWhere((r) => r.code).text, 'e');
      expect(runs.map((r) => r.text).join(), 'a b c d e');
    });

    test('does NOT format intra-word text, math or paths', () {
      for (final s in [
        'snake_case',
        '2*3=6',
        'a_b_c',
        'http://x/y_z',
        'C*',
        'plain text',
      ]) {
        final runs = parseMessageFormat(s);
        expect(runs.every((r) => r.isPlain), true, reason: s);
        expect(runs.map((r) => r.text).join(), s, reason: s);
      }
    });

    test('||spoiler|| is recognised', () {
      final runs = parseMessageFormat('it was ||the butler||');
      expect(runs.firstWhere((r) => r.spoiler).text, 'the butler');
    });

    test('bold and italic nest', () {
      final r = parseMessageFormat('*_x_*').single;
      expect(r.bold && r.italic, true);
      expect(r.text, 'x');
    });

    test('inline code is literal inside', () {
      final r = parseMessageFormat('`a*b*c`').single;
      expect(r.code, true);
      expect(r.text, 'a*b*c');
    });

    test('unmatched markers stay literal', () {
      final runs = parseMessageFormat('*hello');
      expect(runs.every((r) => r.isPlain), true);
      expect(runs.map((r) => r.text).join(), '*hello');
    });

    test('hasFormatting pre-check', () {
      expect(hasFormatting('plain text'), false);
      expect(hasFormatting('a *b*'), true);
      expect(hasFormatting('x||y'), true);
    });
  });

  group('Reminder', () {
    test('parses a pending reminder and falls back to the preview', () {
      final r = Reminder.fromJson({
        'id': 'r1',
        'chatId': 'c1',
        'messageId': 'm1',
        'note': '',
        'preview': 'Ruf zurück',
        'chatTitle': 'Bob',
        'remindAt': 1781730000000,
        'createdAt': 1781720000000,
        'firedAt': null,
      });
      expect(r.fired, false);
      expect(r.label, 'Ruf zurück'); // empty note → preview
      expect(r.remindTime.millisecondsSinceEpoch, 1781730000000);
    });

    test('a fired reminder prefers its note for the label', () {
      final r = Reminder.fromJson({
        'id': 'r2',
        'chatId': 'c1',
        'messageId': 'm1',
        'note': 'Termin bestätigen',
        'preview': 'irgendwas',
        'remindAt': 1781730000000,
        'firedAt': 1781730005000,
      });
      expect(r.fired, true);
      expect(r.label, 'Termin bestätigen');
    });
  });
}
