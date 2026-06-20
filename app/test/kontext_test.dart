// 0.28.0 "Kontext": link-preview URL extraction + parsing, and the message
// editCount round-trip that drives the edit-history viewer.
import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/message.dart';
import 'package:ping/services/link_preview_service.dart';

void main() {
  group('firstUrl', () {
    test('extracts the first http(s) link and trims trailing punctuation', () {
      expect(firstUrl('schau dir https://example.com/x an'),
          'https://example.com/x');
      expect(firstUrl('(siehe https://example.com/a).'),
          'https://example.com/a');
      expect(firstUrl('http://a.test, dann mehr'), 'http://a.test');
    });

    test('returns null when there is no link', () {
      expect(firstUrl('kein Link hier'), isNull);
      expect(firstUrl(''), isNull);
      expect(firstUrl(null), isNull);
      expect(firstUrl('ftp://nope.test'), isNull);
    });
  });

  group('LinkPreview', () {
    test('parses the server payload', () {
      final p = LinkPreview.fromJson({
        'title': 'Titel',
        'description': 'Beschreibung',
        'image': 'https://x/y.png',
        'siteName': 'Example',
        'url': 'https://example.com/',
      });
      expect(p.title, 'Titel');
      expect(p.siteName, 'Example');
      expect(p.url, 'https://example.com/');
    });

    test('tolerates missing fields', () {
      final p = LinkPreview.fromJson({'title': 'Nur Titel', 'url': 'https://x/'});
      expect(p.description, '');
      expect(p.image, '');
    });
  });

  group('Message.editCount', () {
    test('parses and round-trips through JSON', () {
      final m = Message.fromJson({
        'id': 'm1',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'v3',
        'createdAt': 1000,
        'editedAt': 2000,
        'editCount': 2,
      });
      expect(m.editCount, 2);
      expect(m.isEdited, isTrue);

      final round = Message.fromJson(m.toJson());
      expect(round.editCount, 2);
    });

    test('defaults to 0 when absent', () {
      final m = Message.fromJson({
        'id': 'm2',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'text',
        'body': 'hi',
        'createdAt': 1000,
      });
      expect(m.editCount, 0);
      expect(m.toJson().containsKey('editCount'), isFalse);
    });
  });
}
