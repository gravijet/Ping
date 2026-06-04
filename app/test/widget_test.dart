import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/message.dart';
import 'package:ping/widgets/avatar.dart';
import 'package:ping/widgets/message_bubble.dart';
import 'package:ping/widgets/receipt_ticks.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
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
}
