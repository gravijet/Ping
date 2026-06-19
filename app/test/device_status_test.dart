import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/device_status.dart';

void main() {
  group('bucketing', () {
    test('batteryBucket bands the level', () {
      expect(batteryBucket(-1), 'unknown');
      expect(batteryBucket(0), '0-19');
      expect(batteryBucket(19), '0-19');
      expect(batteryBucket(20), '20-39');
      expect(batteryBucket(59), '40-59');
      expect(batteryBucket(80), '80-100');
      expect(batteryBucket(100), '80-100');
    });

    test('ramBucket bands total bytes into GB', () {
      const gb = 1024 * 1024 * 1024;
      expect(ramBucket(0), 'unknown');
      expect(ramBucket(1 * gb), '<2');
      expect(ramBucket(3 * gb), '2-4');
      expect(ramBucket(6 * gb), '6-8');
      expect(ramBucket(8 * gb), '8+');
      expect(ramBucket(12 * gb), '8+');
    });

    test('androidBucket reduces a release to its major', () {
      expect(androidBucket('14'), '14');
      expect(androidBucket('13.0'), '13');
      expect(androidBucket('12.1.0'), '12');
      expect(androidBucket(''), 'unknown');
    });
  });

  group('fromMap is null-safe', () {
    test('BatteryStatus tolerates partial/typed-wrong maps', () {
      expect(BatteryStatus.fromMap(null), isNull);
      expect(BatteryStatus.fromMap({}), isNull);
      final b = BatteryStatus.fromMap({
        'level': 55,
        'charging': true,
        'plugged': 'usb',
        'health': 'good',
        'temperature': 31.5,
        'voltage': 4200,
        'technology': 'Li-ion',
      });
      expect(b, isNotNull);
      expect(b!.level, 55);
      expect(b.charging, isTrue);
      expect(b.temperature, 31.5);
      expect(b.voltage, 4200);
    });

    test('MemoryStatus derives used and ratio', () {
      final m = MemoryStatus.fromMap({'total': 100, 'avail': 40});
      expect(m, isNotNull);
      expect(m!.used, 60);
      expect(m.usedRatio, 0.6);
    });

    test('NetworkStatus online getter ignores none/unknown', () {
      expect(NetworkStatus.fromMap({'type': 'wifi'})!.online, isTrue);
      expect(NetworkStatus.fromMap({'type': 'none'})!.online, isFalse);
      expect(NetworkStatus.fromMap({'type': 'unknown'})!.online, isFalse);
    });

    test('DeviceInfo parses ABIs list and kernel', () {
      final d = DeviceInfo.fromMap({
        'manufacturer': 'Google',
        'model': 'Pixel 8',
        'androidRelease': '14',
        'sdkInt': 34,
        'abis': ['arm64-v8a', 'armeabi-v7a'],
        'kernel': '6.1.43-android14',
      });
      expect(d, isNotNull);
      expect(d!.abis.first, 'arm64-v8a');
      expect(d.kernel, startsWith('6.1'));
    });
  });

  group('deviceBuckets', () {
    test('builds the shared metric vocabulary from a snapshot', () {
      const gb = 1024 * 1024 * 1024;
      final s = DeviceStatus(
        battery: const BatteryStatus(
            level: 72, charging: false, plugged: 'unplugged', health: 'good'),
        thermal: const ThermalStatus(thermal: 'light', powerSave: true, deviceIdle: false),
        network: const NetworkStatus(type: 'cellular', metered: true),
        memory: MemoryStatus(total: 6 * gb, avail: 2 * gb, used: 4 * gb, lowMemory: false, threshold: 0),
        device: const DeviceInfo(
          manufacturer: 'Google',
          model: 'Pixel 8',
          brand: 'google',
          androidRelease: '14.0',
          sdkInt: 34,
          abis: ['arm64-v8a'],
          kernel: '6.1',
          uptimeMillis: 1000,
        ),
      );
      final m = deviceBuckets(s);
      expect(m['platform'], 'android');
      expect(m['android'], '14');
      expect(m['abi'], 'arm64-v8a');
      expect(m['battery'], '60-79');
      expect(m['charging'], 'no');
      expect(m['ram'], '6-8');
      expect(m['net'], 'cellular');
      expect(m['metered'], 'yes');
      expect(m['thermal'], 'light');
      expect(m['powersave'], 'on');
    });

    test('omits unavailable readings', () {
      const s = DeviceStatus(); // every field null
      final m = deviceBuckets(s);
      expect(m, {'platform': 'android'});
    });
  });
}
