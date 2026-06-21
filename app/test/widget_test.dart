import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/message.dart';
import 'package:ping/models/user.dart';
import 'package:ping/widgets/avatar.dart';
import 'package:ping/widgets/message_bubble.dart';
import 'package:ping/widgets/receipt_ticks.dart';
import 'package:ping/widgets/verified_badge.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('trust badges', () {
    test('badgeKindFor follows the official > verified > premium priority', () {
      PingUser u({bool o = false, bool v = false, bool p = false}) => PingUser(
            id: 'x',
            phone: '+4900',
            displayName: 'X',
            avatarColor: '#000000',
            official: o,
            verified: v,
            premium: p,
          );
      expect(badgeKindFor(null), isNull);
      expect(badgeKindFor(u()), isNull);
      expect(badgeKindFor(u(o: true, v: true, p: true)), BadgeKind.official);
      expect(badgeKindFor(u(v: true, p: true)), BadgeKind.verified);
      expect(badgeKindFor(u(p: true)), BadgeKind.premium);
    });

    testWidgets('NameWithBadge renders the name and a badge for an official user',
        (tester) async {
      const team = PingUser(
        id: 'ping-official',
        phone: '',
        displayName: 'Ping Team',
        avatarColor: '#5C6BC0',
        official: true,
      );
      await tester.pumpWidget(_wrap(
        const NameWithBadge(name: 'Ping Team', user: team),
      ));
      expect(find.text('Ping Team'), findsOneWidget);
      expect(find.byType(PingBadge), findsOneWidget);
    });

    testWidgets('NameWithBadge shows no badge for a plain user', (tester) async {
      const plain = PingUser(
        id: '1',
        phone: '+4901',
        displayName: 'Lena',
        avatarColor: '#EF5350',
      );
      await tester.pumpWidget(_wrap(
        const NameWithBadge(name: 'Lena', user: plain),
      ));
      expect(find.text('Lena'), findsOneWidget);
      expect(find.byType(PingBadge), findsNothing);
    });
  });

  testWidgets('avatar shows initials and online dot', (tester) async {
    await tester.pumpWidget(_wrap(
      const PingAvatar(initials: 'LM', color: Colors.indigo, online: true),
    ));
    expect(find.text('LM'), findsOneWidget);
  });

  testWidgets('read receipt renders a double tick', (tester) async {
    await tester.pumpWidget(
        _wrap(const ReceiptTicks(status: MessageStatus.read)));
    expect(find.byIcon(Icons.done_all_rounded), findsOneWidget);
  });

  testWidgets('sending receipt renders a clock', (tester) async {
    await tester.pumpWidget(
        _wrap(const ReceiptTicks(status: MessageStatus.sending)));
    expect(find.byIcon(Icons.schedule_rounded), findsOneWidget);
  });

  testWidgets('message bubble shows body and time', (tester) async {
    final msg = Message(
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      type: 'text',
      body: 'Hallo Welt',
      createdAt: DateTime(2024, 1, 1, 14, 30).millisecondsSinceEpoch,
      status: MessageStatus.sent,
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: true)));
    expect(find.text('Hallo Welt'), findsOneWidget);
    expect(find.text('14:30'), findsOneWidget);
  });

  testWidgets('message bubble renders a quoted reply preview', (tester) async {
    final original = Message(
      id: 'm1',
      chatId: 'c1',
      senderId: 'u2',
      type: 'text',
      body: 'Ursprüngliche Nachricht',
      createdAt: DateTime(2024, 1, 1, 8, 0).millisecondsSinceEpoch,
    );
    final reply = Message(
      id: 'm2',
      chatId: 'c1',
      senderId: 'u1',
      type: 'text',
      body: 'Meine Antwort',
      replyTo: 'm1',
      createdAt: DateTime(2024, 1, 1, 8, 5).millisecondsSinceEpoch,
    );
    await tester.pumpWidget(_wrap(MessageBubble(
      message: reply,
      isMine: true,
      repliedTo: original,
      repliedToSender: 'Mara',
    )));
    expect(find.text('Meine Antwort'), findsOneWidget);
    expect(find.text('Ursprüngliche Nachricht'), findsOneWidget);
    expect(find.text('Mara'), findsOneWidget);
  });

  testWidgets('deleted message shows a removed notice', (tester) async {
    final msg = Message(
      id: 'm2',
      chatId: 'c1',
      senderId: 'u1',
      type: 'text',
      body: '',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
      deleted: true,
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: false)));
    expect(find.textContaining('gelöscht'), findsOneWidget);
  });

  testWidgets('system message is centered text', (tester) async {
    final msg = Message(
      id: 'm3',
      chatId: 'c1',
      senderId: null,
      type: 'system',
      body: 'Gruppe erstellt',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: false)));
    expect(find.text('Gruppe erstellt'), findsOneWidget);
  });

  // ── „Alles" (0.34.0) structured-message rendering ────────────────────────

  testWidgets('event bubble renders title + RSVP buttons', (tester) async {
    final msg = Message(
      id: 'e1', chatId: 'c1', senderId: 'u1', type: 'event', body: '',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
      event: const EventData(
        id: 'ev1', title: 'Team-Lunch', startAt: 1000, location: 'Kantine',
        myStatus: 'going', counts: {'going': 2},
      ),
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: false)));
    expect(find.text('Team-Lunch'), findsOneWidget);
    expect(find.text('✅'), findsOneWidget); // RSVP "going" button
  });

  testWidgets('task list bubble renders items + progress', (tester) async {
    final msg = Message(
      id: 't1', chatId: 'c1', senderId: 'u1', type: 'tasklist', body: '',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
      tasklist: const TaskListData(
        id: 'tl1', title: 'Einkauf', total: 2, completed: 1,
        items: [
          TaskItem(id: 'i1', text: 'Milch', done: true),
          TaskItem(id: 'i2', text: 'Brot', done: false),
        ],
      ),
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: false)));
    expect(find.text('Einkauf'), findsOneWidget);
    expect(find.text('Milch'), findsOneWidget);
    expect(find.text('Brot'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
  });

  testWidgets('game bubble renders a tic-tac-toe grid', (tester) async {
    final msg = Message(
      id: 'g1', chatId: 'c1', senderId: 'u1', type: 'game', body: '',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
      game: const GameData(
        kind: 'tictactoe',
        cells: [0, null, 1, null, null, null, null, null, null],
        players: ['u1', 'u2'], turn: 'u2',
      ),
    );
    await tester.pumpWidget(_wrap(MessageBubble(message: msg, isMine: false)));
    expect(find.text('Tic-Tac-Toe'), findsOneWidget);
    expect(find.text('🔵'), findsWidgets);
  });

  testWidgets('view-once bubble shows tap-to-view for the recipient',
      (tester) async {
    final msg = Message(
      id: 'v1', chatId: 'c1', senderId: 'u1', type: 'image', body: '',
      createdAt: DateTime(2024, 1, 1, 9, 0).millisecondsSinceEpoch,
      viewOnce: true,
    );
    await tester.pumpWidget(_wrap(
        MessageBubble(message: msg, isMine: false, onOpenViewOnce: () {})));
    expect(find.text('Einmal ansehen'), findsOneWidget);
  });
}
