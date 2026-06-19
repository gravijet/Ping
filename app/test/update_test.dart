import 'package:flutter_test/flutter_test.dart';
import 'package:ping/services/update_info.dart';

void main() {
  group('semverGreater', () {
    test('compares marketing versions component-wise', () {
      expect(semverGreater('0.2.0', '0.1.9'), isTrue);
      expect(semverGreater('0.23.0', '0.22.0'), isTrue);
      expect(semverGreater('1.0.0', '0.99.99'), isTrue);
      expect(semverGreater('0.22.0', '0.22.0'), isFalse);
      expect(semverGreater('0.21.0', '0.22.0'), isFalse);
    });

    test('ignores build suffixes', () {
      expect(semverGreater('0.23.0+28', '0.22.0+27'), isTrue);
      expect(semverGreater('0.23.0+28', '0.23.0+27'), isFalse);
    });
  });

  group('UpdateInfo.fromJson', () {
    test('parses fields and resolves a relative url against the base', () {
      final info = UpdateInfo.fromJson({
        'version': '0.23.0',
        'build': '0.23.0+28',
        'versionCode': 28,
        'size': 12345,
        'sha256': 'abc',
        'url': '/download',
      }, 'https://example.test/');
      expect(info.version, '0.23.0');
      expect(info.build, '0.23.0+28');
      expect(info.versionCode, 28);
      expect(info.size, 12345);
      expect(info.sha256, 'abc');
      // Trailing slash on the base is trimmed; no double slash.
      expect(info.downloadUrl, 'https://example.test/download');
    });

    test('accepts a string versionCode and an absolute url', () {
      final info = UpdateInfo.fromJson({
        'version': '0.23.0',
        'versionCode': '2028',
        'url': 'https://cdn.test/ping.apk',
      }, 'https://example.test');
      expect(info.versionCode, 2028);
      expect(info.downloadUrl, 'https://cdn.test/ping.apk');
      // build falls back to version when absent.
      expect(info.build, '0.23.0');
    });

    test('tolerates a missing/garbled versionCode', () {
      final info = UpdateInfo.fromJson({'version': '0.23.0'}, 'https://x.test');
      expect(info.versionCode, isNull);
      expect(info.size, 0);
    });
  });

  group('apkStateFromString', () {
    test('maps known states', () {
      expect(apkStateFromString('pending'), ApkDownloadState.pending);
      expect(apkStateFromString('running'), ApkDownloadState.running);
      expect(apkStateFromString('paused'), ApkDownloadState.paused);
      expect(apkStateFromString('successful'), ApkDownloadState.successful);
      expect(apkStateFromString('failed'), ApkDownloadState.failed);
      expect(apkStateFromString('none'), ApkDownloadState.none);
    });

    test('falls back to unknown for anything else', () {
      expect(apkStateFromString('weird'), ApkDownloadState.unknown);
      expect(apkStateFromString(null), ApkDownloadState.unknown);
    });
  });

  group('ApkDownloadProgress', () {
    test('fraction is null until the total is known, then clamps to 0..1', () {
      expect(const ApkDownloadProgress(state: ApkDownloadState.running).fraction,
          isNull);
      expect(
          const ApkDownloadProgress(
                  state: ApkDownloadState.running, bytes: 0, total: -1)
              .fraction,
          isNull);
      expect(
          const ApkDownloadProgress(
                  state: ApkDownloadState.running, bytes: 50, total: 100)
              .fraction,
          0.5);
      // Over-reported bytes never push the bar past 100 %.
      expect(
          const ApkDownloadProgress(
                  state: ApkDownloadState.successful, bytes: 120, total: 100)
              .fraction,
          1.0);
    });

    test('classifies lifecycle states', () {
      const running = ApkDownloadProgress(state: ApkDownloadState.running);
      const paused = ApkDownloadProgress(state: ApkDownloadState.paused);
      const done = ApkDownloadProgress(state: ApkDownloadState.successful);
      const failed = ApkDownloadProgress(state: ApkDownloadState.failed);
      const none = ApkDownloadProgress(state: ApkDownloadState.none);

      expect(running.isActive, isTrue);
      expect(paused.isActive, isTrue);
      expect(done.isActive, isFalse);

      expect(done.isDone, isTrue);
      expect(running.isDone, isFalse);

      expect(failed.isFailed, isTrue);
      expect(none.isFailed, isTrue);
      expect(done.isFailed, isFalse);
    });
  });

  group('jsonDecodeSafe', () {
    test('decodes objects and returns null on bad input', () {
      expect(jsonDecodeSafe('{"a":1}'), {'a': 1});
      expect(jsonDecodeSafe(''), isNull);
      expect(jsonDecodeSafe('not json'), isNull);
      expect(jsonDecodeSafe('[1,2,3]'), isNull); // not a map
    });
  });
}
