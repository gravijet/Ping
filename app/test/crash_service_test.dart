import 'package:flutter_test/flutter_test.dart';
import 'package:ping/services/crash_service.dart';

void main() {
  final crash = CrashService.instance;

  setUp(() async {
    await crash.clear();
    crash.version = '0.26.0+31';
  });

  group('record', () {
    test('captures errors newest-first', () {
      crash.record(Exception('first'), StackTrace.empty);
      crash.record(Exception('second'), StackTrace.empty);
      expect(crash.count, 2);
      expect(crash.reports.first.headline, contains('second'));
      expect(crash.reports.last.headline, contains('first'));
    });

    test('marks fatal flag and context', () {
      crash.record(StateError('boom'), StackTrace.empty,
          context: 'TestZone', fatal: true);
      final r = crash.reports.first;
      expect(r.fatal, isTrue);
      expect(r.context, 'TestZone');
      expect(r.version, '0.26.0+31');
    });

    test('ring buffer is capped at 50 reports', () {
      for (var i = 0; i < 60; i++) {
        crash.record(Exception('e$i'), StackTrace.empty);
      }
      expect(crash.count, 50);
      // The oldest 10 fell off the back; the newest is on top.
      expect(crash.reports.first.headline, contains('e59'));
    });
  });

  group('guard', () {
    test('captures an asynchronous error without rethrowing', () async {
      crash.guard(() {
        throw Exception('async-boom');
      });
      // Let the zone deliver the error to the handler.
      await Future<void>.delayed(Duration.zero);
      expect(crash.count, 1);
      expect(crash.reports.first.fatal, isTrue);
      expect(crash.reports.first.headline, contains('async-boom'));
    });
  });

  group('redaction', () {
    test('strips phone numbers and bearer tokens before storing', () {
      crash.record(
        Exception('failed for +43 664 1234567 with Bearer abc123def456ghi'),
        StackTrace.empty,
      );
      final dump = crash.exportText();
      expect(dump, contains('‹number›'));
      expect(dump, contains('‹redacted›'));
      expect(dump, isNot(contains('1234567')));
      expect(dump, isNot(contains('abc123def456ghi')));
    });

    test('redacts token= / password= fragments', () {
      crash.record(Exception('token=supersecretvalue123'), StackTrace.empty);
      final dump = crash.exportText();
      expect(dump, isNot(contains('supersecretvalue123')));
      expect(dump, contains('‹redacted›'));
    });
  });

  group('serialization', () {
    test('CrashReport round-trips through JSON', () {
      final original = CrashReport(
        time: DateTime.parse('2026-06-19T12:34:56'),
        version: '0.26.0+31',
        error: 'Exception: nope',
        stack: '#0 main',
        context: 'Boot',
        fatal: true,
      );
      final copy = CrashReport.fromJson(original.toJson());
      expect(copy.version, original.version);
      expect(copy.error, original.error);
      expect(copy.context, 'Boot');
      expect(copy.fatal, isTrue);
    });
  });

  test('clear empties the buffer', () async {
    crash.record(Exception('x'), StackTrace.empty);
    expect(crash.isEmpty, isFalse);
    await crash.clear();
    expect(crash.isEmpty, isTrue);
    expect(crash.count, 0);
  });
}
