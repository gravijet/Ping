// Typed, null-safe views over the raw maps the Android `ping/native` bridge
// returns for device diagnostics (battery, thermal, network, storage, memory,
// device/OS identity). Every `fromMap` tolerates missing or wrongly-typed keys
// so a vendor quirk degrades to `null` fields instead of throwing.
//
// The free functions at the bottom turn readings into the *coarse buckets*
// shared with the web client and the server fleet view — deliberately pure so
// they can be unit-tested without a device.

double? _asDouble(Object? v) => v is num ? v.toDouble() : null;
int? _asInt(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _asString(Object? v) => v is String && v.isNotEmpty ? v : null;

class BatteryStatus {
  final int level; // 0..100, or -1 if unknown
  final bool charging;
  final String plugged; // ac | usb | wireless | unplugged | unknown
  final String health; // good | overheat | cold | dead | …
  final double? temperature; // °C
  final int? voltage; // mV
  final String? technology;

  const BatteryStatus({
    required this.level,
    required this.charging,
    required this.plugged,
    required this.health,
    this.temperature,
    this.voltage,
    this.technology,
  });

  static BatteryStatus? fromMap(Map<Object?, Object?>? m) {
    if (m == null || m.isEmpty) return null;
    return BatteryStatus(
      level: _asInt(m['level']) ?? -1,
      charging: m['charging'] == true,
      plugged: _asString(m['plugged']) ?? 'unknown',
      health: _asString(m['health']) ?? 'unknown',
      temperature: _asDouble(m['temperature']),
      voltage: _asInt(m['voltage']),
      technology: _asString(m['technology']),
    );
  }
}

class ThermalStatus {
  final String? thermal; // none | light | moderate | severe | … (null < API 29)
  final bool powerSave;
  final bool deviceIdle;

  const ThermalStatus({this.thermal, required this.powerSave, required this.deviceIdle});

  static ThermalStatus? fromMap(Map<Object?, Object?>? m) {
    if (m == null) return null;
    return ThermalStatus(
      thermal: _asString(m['thermal']),
      powerSave: m['powerSave'] == true,
      deviceIdle: m['deviceIdle'] == true,
    );
  }
}

class NetworkStatus {
  final String type; // wifi | cellular | ethernet | vpn | bluetooth | none | …
  final bool metered;
  final bool validated;
  final int? downKbps;

  const NetworkStatus({
    required this.type,
    required this.metered,
    this.validated = false,
    this.downKbps,
  });

  bool get online => type != 'none' && type != 'unknown';

  static NetworkStatus? fromMap(Map<Object?, Object?>? m) {
    if (m == null) return null;
    return NetworkStatus(
      type: _asString(m['type']) ?? 'unknown',
      metered: m['metered'] == true,
      validated: m['validated'] == true,
      downKbps: _asInt(m['downKbps']),
    );
  }
}

class StorageStatus {
  final int total;
  final int free;
  final int used;
  final int appBytes;

  const StorageStatus({
    required this.total,
    required this.free,
    required this.used,
    required this.appBytes,
  });

  double get usedRatio => total > 0 ? used / total : 0;

  static StorageStatus? fromMap(Map<Object?, Object?>? m) {
    if (m == null || m.isEmpty) return null;
    final total = _asInt(m['total']) ?? 0;
    final free = _asInt(m['free']) ?? 0;
    return StorageStatus(
      total: total,
      free: free,
      used: _asInt(m['used']) ?? (total - free),
      appBytes: _asInt(m['appBytes']) ?? 0,
    );
  }
}

class MemoryStatus {
  final int total;
  final int avail;
  final int used;
  final bool lowMemory;
  final int threshold;

  const MemoryStatus({
    required this.total,
    required this.avail,
    required this.used,
    required this.lowMemory,
    required this.threshold,
  });

  double get usedRatio => total > 0 ? used / total : 0;

  static MemoryStatus? fromMap(Map<Object?, Object?>? m) {
    if (m == null || m.isEmpty) return null;
    final total = _asInt(m['total']) ?? 0;
    final avail = _asInt(m['avail']) ?? 0;
    return MemoryStatus(
      total: total,
      avail: avail,
      used: _asInt(m['used']) ?? (total - avail),
      lowMemory: m['lowMemory'] == true,
      threshold: _asInt(m['threshold']) ?? 0,
    );
  }
}

class DeviceInfo {
  final String manufacturer;
  final String model;
  final String brand;
  final String androidRelease;
  final int sdkInt;
  final String? securityPatch;
  final List<String> abis;
  final String kernel;
  final int uptimeMillis;

  const DeviceInfo({
    required this.manufacturer,
    required this.model,
    required this.brand,
    required this.androidRelease,
    required this.sdkInt,
    this.securityPatch,
    required this.abis,
    required this.kernel,
    required this.uptimeMillis,
  });

  static DeviceInfo? fromMap(Map<Object?, Object?>? m) {
    if (m == null || m.isEmpty) return null;
    return DeviceInfo(
      manufacturer: _asString(m['manufacturer']) ?? '',
      model: _asString(m['model']) ?? '',
      brand: _asString(m['brand']) ?? '',
      androidRelease: _asString(m['androidRelease']) ?? '',
      sdkInt: _asInt(m['sdkInt']) ?? 0,
      securityPatch: _asString(m['securityPatch']),
      abis: (m['abis'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      kernel: _asString(m['kernel']) ?? '',
      uptimeMillis: _asInt(m['uptimeMillis']) ?? 0,
    );
  }
}

/// One bundled snapshot. Any field may be null where the platform doesn't
/// expose it (or off-Android entirely).
class DeviceStatus {
  final BatteryStatus? battery;
  final ThermalStatus? thermal;
  final NetworkStatus? network;
  final StorageStatus? storage;
  final MemoryStatus? memory;
  final DeviceInfo? device;

  const DeviceStatus({
    this.battery,
    this.thermal,
    this.network,
    this.storage,
    this.memory,
    this.device,
  });

  bool get isEmpty =>
      battery == null &&
      thermal == null &&
      network == null &&
      storage == null &&
      memory == null &&
      device == null;
}

// ---- bucketing (pure, shared vocabulary with web + server) ----------------

String batteryBucket(int level) {
  if (level < 0) return 'unknown';
  if (level < 20) return '0-19';
  if (level < 40) return '20-39';
  if (level < 60) return '40-59';
  if (level < 80) return '60-79';
  return '80-100';
}

/// Bucket total RAM (bytes) into GB bands. Devices rarely advertise a clean
/// power of two, so we round to the nearest GB before banding.
String ramBucket(int totalBytes) {
  if (totalBytes <= 0) return 'unknown';
  final gb = totalBytes / (1024 * 1024 * 1024);
  if (gb < 2) return '<2';
  if (gb < 4) return '2-4';
  if (gb < 6) return '4-6';
  if (gb < 8) return '6-8';
  return '8+';
}

/// Android marketing version → major release label (e.g. "14.0" → "14").
String androidBucket(String release) {
  if (release.isEmpty) return 'unknown';
  final dot = release.indexOf('.');
  return dot > 0 ? release.substring(0, dot) : release;
}

/// The coarse, privacy-safe metric→bucket map sent to /api/telemetry/device.
/// Mirrors the web client's vocabulary so the server aggregates both cleanly.
Map<String, String> deviceBuckets(DeviceStatus s) {
  final m = <String, String>{'platform': 'android'};
  final d = s.device;
  if (d != null) {
    m['android'] = androidBucket(d.androidRelease);
    if (d.abis.isNotEmpty) m['abi'] = d.abis.first;
  }
  final b = s.battery;
  if (b != null && b.level >= 0) {
    m['battery'] = batteryBucket(b.level);
    m['charging'] = b.charging ? 'yes' : 'no';
  }
  final mem = s.memory;
  if (mem != null && mem.total > 0) m['ram'] = ramBucket(mem.total);
  final n = s.network;
  if (n != null) {
    m['net'] = n.type;
    m['metered'] = n.metered ? 'yes' : 'no';
  }
  final t = s.thermal;
  if (t != null) {
    if (t.thermal != null) m['thermal'] = t.thermal!;
    m['powersave'] = t.powerSave ? 'on' : 'off';
  }
  return m;
}
