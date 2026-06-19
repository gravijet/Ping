import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/device_status.dart';
import '../services/app_state.dart';
import '../services/device_info_service.dart';

/// "Geräte & Diagnose" — a live, read-only view of the device's hardware/OS
/// signals (battery, power/thermal state, network, RAM, storage, OS + kernel),
/// read over the native bridge. Refreshes itself every few seconds and via
/// pull-to-refresh. Honours the reduce-motion accessibility setting (no animated
/// gauges then) and is fully labelled for screen readers.
class DeviceScreen extends StatefulWidget {
  const DeviceScreen({super.key});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  final _service = DeviceInfoService();
  DeviceStatus? _status;
  bool _loading = true;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _refresh();
    // Light-touch live updates while the screen is open.
    _ticker = Timer.periodic(const Duration(seconds: 4), (_) => _refresh(quiet: true));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _refresh({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    final s = await _service.snapshot();
    if (!mounted) return;
    setState(() {
      _status = s;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = context.select<AppState, bool>((s) => s.settings.reduceMotion);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Geräte & Diagnose'),
        actions: [
          IconButton(
            tooltip: 'Aktualisieren',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => _refresh(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _refresh(),
        child: _loading && _status == null
            ? const _DiagSkeleton()
            : !_service.supported
                ? const _Unsupported()
                : _DiagBody(status: _status!, reduceMotion: reduceMotion, service: _service),
      ),
    );
  }
}

class _Unsupported extends StatelessWidget {
  const _Unsupported();
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: const [
        SizedBox(height: 80),
        Icon(Icons.devices_other_rounded, size: 48),
        SizedBox(height: 12),
        Center(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              'Gerätediagnose ist nur in der Android-App verfügbar.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}

class _DiagBody extends StatelessWidget {
  const _DiagBody({required this.status, required this.reduceMotion, required this.service});
  final DeviceStatus status;
  final bool reduceMotion;
  final DeviceInfoService service;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        if (status.battery != null) _battery(context, status.battery!),
        if (status.thermal != null) _power(context, status.thermal!),
        if (status.network != null) _network(context, status.network!),
        if (status.memory != null) _memory(context),
        if (status.storage != null) _storage(context),
        if (status.device != null) _system(context, status.device!),
        _haptics(context),
      ],
    );
  }

  // ---- Akku ---------------------------------------------------------------
  Widget _battery(BuildContext context, BatteryStatus b) {
    final scheme = Theme.of(context).colorScheme;
    final color = b.level < 20 ? scheme.error : (b.charging ? Colors.green : scheme.primary);
    return _Section(
      icon: b.charging ? Icons.battery_charging_full_rounded : Icons.battery_full_rounded,
      title: 'Akku',
      children: [
        _Gauge(
          label: b.charging ? 'Lädt' : 'Ladestand',
          value: b.level < 0 ? 0 : b.level / 100,
          valueLabel: b.level < 0 ? '—' : '${b.level}%${b.charging ? '  ⚡' : ''}',
          color: color,
          reduceMotion: reduceMotion,
        ),
        const SizedBox(height: 10),
        _kvWrap([
          if (b.temperature != null) _Kv('Temperatur', '${b.temperature!.toStringAsFixed(1)} °C'),
          _Kv('Zustand', _healthLabel(b.health)),
          _Kv('Anschluss', _plugLabel(b.plugged)),
          if (b.voltage != null) _Kv('Spannung', '${(b.voltage! / 1000).toStringAsFixed(2)} V'),
          if (b.technology != null) _Kv('Typ', b.technology!),
        ]),
      ],
    );
  }

  // ---- Energie & Temperatur ----------------------------------------------
  Widget _power(BuildContext context, ThermalStatus t) {
    return _Section(
      icon: Icons.thermostat_rounded,
      title: 'Energie & Temperatur',
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (t.thermal != null) _Chip(_thermalLabel(t.thermal!), tone: _thermalTone(t.thermal!)),
            _Chip(t.powerSave ? 'Energiesparen an' : 'Energiesparen aus',
                tone: t.powerSave ? _Tone.warn : _Tone.ok),
            if (t.deviceIdle) const _Chip('Doze-Modus', tone: _Tone.warn),
          ],
        ),
      ],
    );
  }

  // ---- Netzwerk -----------------------------------------------------------
  Widget _network(BuildContext context, NetworkStatus n) {
    return _Section(
      icon: _netIcon(n.type),
      title: 'Netzwerk',
      children: [
        _kvWrap([
          _Kv('Verbindung', _netLabel(n.type)),
          _Kv('Abrechnung', n.metered ? 'getaktet' : 'ungetaktet'),
          if (n.downKbps != null && n.downKbps! > 0)
            _Kv('Bandbreite', '${(n.downKbps! / 1000).toStringAsFixed(0)} Mbit/s'),
          _Kv('Internet', n.validated ? 'geprüft' : 'ungeprüft'),
        ]),
        if (n.metered)
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: _Note('Über eine getaktete Verbindung lädt Ping große Medien nicht '
                'automatisch vor, um dein Datenvolumen zu schonen.'),
          ),
      ],
    );
  }

  // ---- Arbeitsspeicher ----------------------------------------------------
  Widget _memory(BuildContext context) {
    final m = status.memory!;
    final scheme = Theme.of(context).colorScheme;
    return _Section(
      icon: Icons.memory_rounded,
      title: 'Arbeitsspeicher',
      children: [
        _Gauge(
          label: 'Belegt',
          value: m.usedRatio,
          valueLabel: '${_fmtBytes(m.used)} / ${_fmtBytes(m.total)}',
          color: m.lowMemory ? scheme.error : scheme.primary,
          reduceMotion: reduceMotion,
        ),
        if (m.lowMemory)
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: _Note('Das System meldet wenig freien Speicher.'),
          ),
      ],
    );
  }

  // ---- Speicher -----------------------------------------------------------
  Widget _storage(BuildContext context) {
    final s = status.storage!;
    final scheme = Theme.of(context).colorScheme;
    return _Section(
      icon: Icons.sd_storage_rounded,
      title: 'Gerätespeicher',
      children: [
        _Gauge(
          label: 'Belegt',
          value: s.usedRatio,
          valueLabel: '${_fmtBytes(s.used)} / ${_fmtBytes(s.total)}',
          color: s.usedRatio > 0.9 ? scheme.error : scheme.primary,
          reduceMotion: reduceMotion,
        ),
        const SizedBox(height: 10),
        _kvWrap([
          _Kv('Frei', _fmtBytes(s.free)),
          _Kv('Ping belegt', _fmtBytes(s.appBytes)),
        ]),
      ],
    );
  }

  // ---- System -------------------------------------------------------------
  Widget _system(BuildContext context, DeviceInfo d) {
    return _Section(
      icon: Icons.phone_android_rounded,
      title: 'System',
      children: [
        _kvWrap([
          _Kv('Gerät', '${d.manufacturer} ${d.model}'.trim()),
          _Kv('Android', '${d.androidRelease} (API ${d.sdkInt})'),
          if (d.securityPatch != null) _Kv('Sicherheitspatch', d.securityPatch!),
          if (d.abis.isNotEmpty) _Kv('CPU-ABI', d.abis.first),
          _Kv('Laufzeit', _fmtUptime(d.uptimeMillis)),
        ]),
        if (d.kernel.isNotEmpty) ...[
          const SizedBox(height: 10),
          _Kv('Kernel', d.kernel),
        ],
      ],
    );
  }

  // ---- Haptik-Test --------------------------------------------------------
  Widget _haptics(BuildContext context) {
    return _Section(
      icon: Icons.vibration_rounded,
      title: 'Haptik',
      children: [
        const _Note('Kurze Vibrationsmuster über die System-Vibration.'),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final p in const ['tick', 'click', 'heavy', 'success', 'error'])
              OutlinedButton(
                onPressed: () => service.vibrate(p),
                child: Text(p),
              ),
          ],
        ),
      ],
    );
  }

  Widget _kvWrap(List<Widget> rows) => Column(children: rows);
}

// ---- shared building blocks -----------------------------------------------

class _Section extends StatelessWidget {
  const _Section({required this.icon, required this.title, required this.children});
  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: scheme.primary),
                const SizedBox(width: 10),
                Text(title, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _Gauge extends StatelessWidget {
  const _Gauge({
    required this.label,
    required this.value,
    required this.valueLabel,
    required this.color,
    required this.reduceMotion,
  });
  final String label;
  final double value; // 0..1
  final String valueLabel;
  final Color color;
  final bool reduceMotion;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final clamped = value.isNaN ? 0.0 : value.clamp(0.0, 1.0);
    final bar = ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: reduceMotion
          ? LinearProgressIndicator(
              value: clamped,
              minHeight: 9,
              backgroundColor: scheme.surfaceContainerHighest,
              valueColor: AlwaysStoppedAnimation(color),
            )
          : TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: clamped),
              duration: const Duration(milliseconds: 450),
              curve: Curves.easeOutCubic,
              builder: (_, v, _) => LinearProgressIndicator(
                value: v,
                minHeight: 9,
                backgroundColor: scheme.surfaceContainerHighest,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
    );
    return Semantics(
      label: '$label: $valueLabel',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5)),
              Text(valueLabel,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
            ],
          ),
          const SizedBox(height: 8),
          bar,
        ],
      ),
    );
  }
}

class _Kv extends StatelessWidget {
  const _Kv(this.k, this.v);
  final String k;
  final String v;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(k, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5)),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: Text(v,
                textAlign: TextAlign.right,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
          ),
        ],
      ),
    );
  }
}

enum _Tone { ok, warn, err }

class _Chip extends StatelessWidget {
  const _Chip(this.label, {this.tone = _Tone.ok});
  final String label;
  final _Tone tone;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = switch (tone) {
      _Tone.ok => Colors.green,
      _Tone.warn => scheme.tertiary,
      _Tone.err => scheme.error,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: base.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: base.withValues(alpha: 0.35)),
      ),
      child: Text(label,
          style: TextStyle(color: base, fontWeight: FontWeight.w600, fontSize: 12.5)),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Text(text,
        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5, height: 1.4));
  }
}

class _DiagSkeleton extends StatelessWidget {
  const _DiagSkeleton();
  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: List.generate(
        4,
        (_) => Card(
          margin: const EdgeInsets.only(bottom: 14),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(width: 140, height: 16, color: base),
                const SizedBox(height: 16),
                Container(width: double.infinity, height: 9, color: base),
                const SizedBox(height: 12),
                Container(width: 200, height: 12, color: base),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---- formatting + labels --------------------------------------------------

String _fmtBytes(int bytes) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var v = bytes.toDouble();
  var i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return '${v.toStringAsFixed(v >= 100 || i == 0 ? 0 : 1)} ${units[i]}';
}

String _fmtUptime(int ms) {
  final d = Duration(milliseconds: ms);
  final days = d.inDays;
  final hours = d.inHours % 24;
  final mins = d.inMinutes % 60;
  if (days > 0) return '${days}d ${hours}h';
  if (hours > 0) return '${hours}h ${mins}m';
  return '${mins}m';
}

String _healthLabel(String h) => switch (h) {
      'good' => 'gut',
      'overheat' => 'überhitzt',
      'cold' => 'kalt',
      'dead' => 'defekt',
      'over_voltage' => 'Überspannung',
      'failure' => 'Fehler',
      _ => 'unbekannt',
    };

String _plugLabel(String p) => switch (p) {
      'ac' => 'Netzteil',
      'usb' => 'USB',
      'wireless' => 'kabellos',
      'unplugged' => 'getrennt',
      _ => 'unbekannt',
    };

String _netLabel(String t) => switch (t) {
      'wifi' => 'WLAN',
      'cellular' => 'Mobilfunk',
      'ethernet' => 'Ethernet',
      'vpn' => 'VPN',
      'bluetooth' => 'Bluetooth',
      'none' => 'getrennt',
      _ => 'unbekannt',
    };

IconData _netIcon(String t) => switch (t) {
      'wifi' => Icons.wifi_rounded,
      'cellular' => Icons.signal_cellular_alt_rounded,
      'ethernet' => Icons.lan_rounded,
      'vpn' => Icons.vpn_lock_rounded,
      'none' => Icons.signal_wifi_off_rounded,
      _ => Icons.network_check_rounded,
    };

String _thermalLabel(String t) => switch (t) {
      'none' => 'Temperatur normal',
      'light' => 'leicht warm',
      'moderate' => 'mäßig warm',
      'severe' => 'heiß',
      'critical' => 'kritisch heiß',
      'emergency' => 'Notfall-Hitze',
      'shutdown' => 'Abschaltung droht',
      _ => 'Temperatur unbekannt',
    };

_Tone _thermalTone(String t) => switch (t) {
      'none' || 'light' => _Tone.ok,
      'moderate' => _Tone.warn,
      _ => _Tone.err,
    };
