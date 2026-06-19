import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/settings.dart';

void main() {
  group('diagnostics settings', () {
    test('default to off (privacy-first)', () {
      const s = PingSettings();
      expect(s.collectMetrics, isFalse);
      expect(s.devOptionsUnlocked, isFalse);
      expect(s.showPerformanceOverlay, isFalse);
    });

    test('survive an encode/decode round-trip', () {
      const s = PingSettings(
        collectMetrics: true,
        devOptionsUnlocked: true,
        showPerformanceOverlay: true,
      );
      final restored = PingSettings.decode(s.encode());
      expect(restored.collectMetrics, isTrue);
      expect(restored.devOptionsUnlocked, isTrue);
      expect(restored.showPerformanceOverlay, isTrue);
    });

    test('copyWith updates each field independently', () {
      const s = PingSettings();
      expect(s.copyWith(collectMetrics: true).collectMetrics, isTrue);
      expect(s.copyWith(devOptionsUnlocked: true).devOptionsUnlocked, isTrue);
      expect(
          s.copyWith(showPerformanceOverlay: true).showPerformanceOverlay,
          isTrue);
      // Other fields are untouched by a targeted copy.
      expect(s.copyWith(collectMetrics: true).devOptionsUnlocked, isFalse);
    });

    test('decoding legacy JSON without the new keys keeps the safe defaults',
        () {
      // A settings blob written by an older build (no diagnostics keys).
      const legacy = '{"readReceipts":true,"enterToSend":true}';
      final s = PingSettings.decode(legacy);
      expect(s.collectMetrics, isFalse);
      expect(s.devOptionsUnlocked, isFalse);
      expect(s.showPerformanceOverlay, isFalse);
      expect(s.enterToSend, isTrue); // the legacy value still applies
    });
  });
}
