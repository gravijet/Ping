import 'package:package_info_plus/package_info_plus.dart';

import 'update_info.dart';

/// Web/desktop stub: the in-app APK self-updater is Android-only. Everything
/// reports "nothing to do" so the shared update UI compiles and simply shows
/// "you're up to date". (Browser/desktop builds are updated by reloading /
/// re-downloading, not by installing an APK.)
class UpdateService {
  bool get supported => false;

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
}
