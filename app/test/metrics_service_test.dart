import 'package:flutter_test/flutter_test.dart';
import 'package:ping/services/metrics_service.dart';

void main() {
  group('opt-in gating', () {
    test('bump is a no-op until enabled', () {
      var enabled = false;
      final m = MetricsService(() => enabled);
      m.bump(MetricKeys.messagesSent);
      m.bump(MetricKeys.messagesSent);
      expect(m.total(MetricKeys.messagesSent), 0);
      expect(m.since, isNull);

      enabled = true;
      m.bump(MetricKeys.messagesSent);
      expect(m.total(MetricKeys.messagesSent), 1);
      expect(m.since, isNotNull);
    });
  });

  group('counting', () {
    late MetricsService m;
    setUp(() => m = MetricsService(() => true));

    test('accumulates totals and respects the increment amount', () {
      m.bump(MetricKeys.messagesSent);
      m.bump(MetricKeys.messagesSent, 4);
      m.bump(MetricKeys.callsStarted);
      expect(m.total(MetricKeys.messagesSent), 5);
      expect(m.total(MetricKeys.callsStarted), 1);
      expect(m.total(MetricKeys.photosSent), 0);
    });

    test('grandTotal sums across every metric', () {
      m.bump(MetricKeys.messagesSent, 3);
      m.bump(MetricKeys.chatsOpened, 2);
      expect(m.grandTotal, 5);
    });

    test('a zero increment changes nothing', () {
      m.bump(MetricKeys.messagesSent, 0);
      expect(m.total(MetricKeys.messagesSent), 0);
      expect(m.since, isNull);
    });
  });

  group('series', () {
    test('returns one value per requested day, today last', () {
      final m = MetricsService(() => true);
      m.bump(MetricKeys.messagesSent, 3);
      final week = m.series(MetricKeys.messagesSent, days: 7);
      expect(week.length, 7);
      // Earlier days had no activity.
      expect(week.sublist(0, 6).every((v) => v == 0), isTrue);
      // Today is the last bucket.
      expect(week.last, 3);
      expect(m.recent(MetricKeys.messagesSent, days: 7), 3);
    });
  });

  group('clear', () {
    test('wipes all counters', () async {
      final m = MetricsService(() => true);
      m.bump(MetricKeys.messagesSent, 9);
      await m.clear();
      expect(m.grandTotal, 0);
      expect(m.total(MetricKeys.messagesSent), 0);
      expect(m.since, isNull);
    });
  });

  group('day key', () {
    test('formats as zero-padded yyyy-MM-dd', () {
      expect(MetricsService.dayKeyForTest(DateTime(2026, 6, 1)), '2026-06-01');
      expect(MetricsService.dayKeyForTest(DateTime(2026, 12, 25)), '2026-12-25');
    });
  });

  group('metric catalogue', () {
    test('every key has a German label', () {
      for (final key in MetricKeys.all) {
        expect(MetricKeys.labels[key], isNotNull,
            reason: 'missing label for $key');
      }
    });
  });
}
