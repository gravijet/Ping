import 'package:package_info_plus/package_info_plus.dart';

import 'update_info.dart';

/// Web/desktop stub: the in-app APK self-updater is Android-only. Everything
/// reports "nothing to do" so the shared update UI compiles and simply shows
/// "you're up to date". (Browser/desktop builds are updated by reloading /
/// re-downloading, not by installing an APK.)
class UpdateService {
  bool get supported => false;

  bool get supportsBackgroundDownload => false;

  PackageInfo? _package;
  Future<PackageInfo?> _info() async {
    try {
      return _package ??= await PackageInfo.fromPlatform();
    } catch (_) {
      return null;
    }
  }

  Future<String> currentVersion() async => (await _info())?.version ?? '';

  Future<int> currentBuildNumber() async =>
      int.tryParse((await _info())?.buildNumber ?? '') ?? 0;

  Future<UpdateInfo?> fetch(String baseUrl) async => null;

  Future<bool> isNewer(UpdateInfo info) async => false;

  Future<String?> cachedApk(UpdateInfo info) async => null;

  Future<String?> download(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async =>
      null;

  Future<bool> install(String path) async => false;

  // Background-download surface — no-ops on web/desktop (those builds update by
  // reloading, not by downloading an APK). Mirrors the Android API so the shared
  // update UI compiles unchanged.
  Future<int?> startBackgroundDownload(UpdateInfo info,
          {bool allowMetered = true}) async =>
      null;

  Future<ApkDownloadProgress> backgroundStatus(int id) async =>
      ApkDownloadProgress.none;

  Future<PendingApkDownload?> pendingDownload(UpdateInfo info) async => null;

  Future<String?> verifiedPath(
          ApkDownloadProgress status, UpdateInfo info) async =>
      null;

  Future<bool> installBackground(int id) async => false;

  Future<void> cancelBackground(int id) async {}

  Future<void> clearPending() async {}

  Future<void> reportEvent(String baseUrl, String name) async {}
}
