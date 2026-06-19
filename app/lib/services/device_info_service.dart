import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import '../models/device_status.dart';
import '../platform.dart';

/// Reads the device's hardware/OS diagnostics over the `ping/native` method
/// channel (battery, thermal, network, storage, memory, device/OS identity) and
/// can fire short haptics. Everything is Android-only and fully defensive: on
/// the web/desktop builds, or if a call fails, the getters return `null`/empty
/// and `vibrate` is a no-op, so callers never have to special-case the platform.
class DeviceInfoService {
  static const _native = MethodChannel('ping/native');

  /// True only where the native bridge exists (the Android build).
  bool get supported => isAndroidPlatform;

  Future<Map<Object?, Object?>?> _map(String method) async {
    if (!supported) return null;
    try {
      final res = await _native.invokeMethod<Map<Object?, Object?>>(method);
      return res;
    } catch (_) {
      return null;
    }
  }

  Future<BatteryStatus?> battery() async => BatteryStatus.fromMap(await _map('batteryStatus'));
  Future<ThermalStatus?> thermal() async => ThermalStatus.fromMap(await _map('thermalStatus'));
  Future<NetworkStatus?> network() async => NetworkStatus.fromMap(await _map('networkType'));
  Future<StorageStatus?> storage() async => StorageStatus.fromMap(await _map('storageInfo'));
  Future<MemoryStatus?> memory() async => MemoryStatus.fromMap(await _map('memoryInfo'));
  Future<DeviceInfo?> device() async => DeviceInfo.fromMap(await _map('deviceInfo'));

  /// One combined snapshot, gathered concurrently. Returns an empty
  /// [DeviceStatus] (every field null) off-Android or on total failure.
  Future<DeviceStatus> snapshot() async {
    if (!supported) return const DeviceStatus();
    final results = await Future.wait([
      battery(),
      thermal(),
      network(),
      storage(),
      memory(),
      device(),
    ]);
    return DeviceStatus(
      battery: results[0] as BatteryStatus?,
      thermal: results[1] as ThermalStatus?,
      network: results[2] as NetworkStatus?,
      storage: results[3] as StorageStatus?,
      memory: results[4] as MemoryStatus?,
      device: results[5] as DeviceInfo?,
    );
  }

  /// Fire a short, distinct haptic. pattern ∈ tick | click | heavy | success |
  /// error. No-op where unsupported; never throws.
  Future<void> vibrate(String pattern) async {
    if (!supported) return;
    try {
      await _native.invokeMethod('vibrate', {'pattern': pattern});
    } catch (_) {
      /* best effort */
    }
  }

  /// Whether non-essential network work (media auto-download, prefetch) should
  /// be held back right now. True when the user enabled data-saver, the active
  /// network is metered, the device is in battery-saver mode, or the battery is
  /// critically low and not charging. Falls back to [userDataSaver] off-Android.
  Future<bool> shouldConserveData({required bool userDataSaver}) async {
    if (userDataSaver) return true;
    if (!supported) return false;
    final results = await Future.wait([network(), thermal(), battery()]);
    final net = results[0] as NetworkStatus?;
    final therm = results[1] as ThermalStatus?;
    final batt = results[2] as BatteryStatus?;
    if (net != null && net.metered) return true;
    if (therm != null && therm.powerSave) return true;
    if (batt != null && batt.level >= 0 && batt.level < 15 && !batt.charging) return true;
    return false;
  }

  /// Send one anonymous, *bucketed* device snapshot to the fleet endpoint.
  /// Best-effort and fire-and-forget — mirrors the OTA funnel reporter. Nothing
  /// identifying leaves the device; see [deviceBuckets].
  Future<void> reportSnapshot(String baseUrl) async {
    if (!supported) return;
    final root = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    try {
      final snap = await snapshot();
      if (snap.isEmpty) return;
      final metrics = deviceBuckets(snap);
      if (metrics.isEmpty) return;
      await http
          .post(
            Uri.parse('$root/api/telemetry/device'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'app': 'android', 'metrics': metrics}),
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      /* telemetry is best-effort */
    }
  }
}
