import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'doc_store.dart';

/// The activities Ping counts for the on-device "Deine Statistik" screen. Each
/// is a plain integer counter — never a message, contact, or anything that
/// identifies *what* you did or *with whom*. Just how many.
class MetricKeys {
  static const messagesSent = 'messagesSent';
  static const chatsOpened = 'chatsOpened';
  static const callsStarted = 'callsStarted';
  static const photosSent = 'photosSent';
  static const voiceSent = 'voiceSent';
  static const statusPosted = 'statusPosted';
  static const appOpens = 'appOpens';

  /// Display order + German labels for the stats screen.
  static const labels = <String, String>{
    messagesSent: 'Nachrichten gesendet',
    chatsOpened: 'Chats geöffnet',
    callsStarted: 'Anrufe gestartet',
    photosSent: 'Fotos gesendet',
    voiceSent: 'Sprachnachrichten',
    statusPosted: 'Status gepostet',
    appOpens: 'App geöffnet',
  };

  static const all = <String>[
    messagesSent,
    chatsOpened,
    callsStarted,
    photosSent,
    voiceSent,
    statusPosted,
    appOpens,
  ];
}

/// One day's worth of counters, keyed by metric.
typedef DayCounts = Map<String, int>;

/// **Opt-in, anonymous, on-device** usage metrics.
///
/// This is the local counterpart to the web client's telemetry, but with a much
/// stricter contract: it only ever stores **integer counts** of your own
/// actions, only when you explicitly turn it on, and the numbers never leave the
/// phone. There is no user id, no message content, no contact — and a single tap
/// in *Einstellungen → Deine Statistik* erases everything.
///
/// Storage shape (`diagnostics/metrics.json`):
/// ```json
/// { "since": "2026-06-01", "totals": {"messagesSent": 42},
///   "days": {"2026-06-19": {"messagesSent": 5}} }
/// ```
class MetricsService {
  MetricsService(this._enabled);

  /// Reads the live opt-in flag (PingSettings.collectMetrics) on every call, so
  /// toggling it off in settings takes effect immediately with no re-wiring.
  final bool Function() _enabled;

  static const _docName = 'diagnostics/metrics.json';
  static const _maxDays = 30; // keep a rolling month of daily buckets

  final Map<String, int> _totals = {};
  final Map<String, DayCounts> _days = {};
  DateTime? _since;
  bool _loaded = false;
  Timer? _saveDebounce;

  bool get enabled => _enabled();

  /// The day this device started tracking (for the "seit …" subtitle).
  DateTime? get since => _since;

  /// Lifetime total for a metric.
  int total(String key) => _totals[key] ?? 0;

  /// Sum across every tracked metric (a single "actions counted" headline).
  int get grandTotal => _totals.values.fold(0, (a, b) => a + b);

  /// The value of [key] for the last [days] calendar days, oldest first — ready
  /// to feed a bar chart. Missing days read as 0.
  List<int> series(String key, {int days = 7}) {
    final now = DateTime.now();
    return List<int>.generate(days, (i) {
      final d = now.subtract(Duration(days: days - 1 - i));
      return _days[_dayKey(d)]?[key] ?? 0;
    });
  }

  /// Total of [key] over the last [days] days (the chart's headline number).
  int recent(String key, {int days = 7}) =>
      series(key, days: days).fold(0, (a, b) => a + b);

  /// Increment a metric by [by]. A no-op unless the user has opted in, so call
  /// sites can fire unconditionally without checking the flag themselves.
  void bump(String key, [int by = 1]) {
    if (!enabled || by == 0) return;
    _since ??= DateTime.now();
    _totals[key] = (_totals[key] ?? 0) + by;
    final dk = _dayKey(DateTime.now());
    final day = _days.putIfAbsent(dk, () => <String, int>{});
    day[key] = (day[key] ?? 0) + by;
    _pruneDays();
    _scheduleSave();
  }

  /// Load persisted counters. Best-effort; safe in tests and before first frame.
  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final raw = await readDoc(_docName);
      if (raw == null || raw.isEmpty) return;
      final j = jsonDecode(raw) as Map<String, dynamic>;
      _since = DateTime.tryParse(j['since'] as String? ?? '');
      (j['totals'] as Map?)?.forEach((k, v) {
        if (v is num) _totals[k as String] = v.toInt();
      });
      (j['days'] as Map?)?.forEach((day, counts) {
        if (counts is Map) {
          _days[day as String] = counts.map(
              (k, v) => MapEntry(k as String, (v is num) ? v.toInt() : 0));
        }
      });
      _pruneDays();
    } catch (_) {
      /* corrupt cache → start clean */
    }
  }

  /// Wipe every counter — both in memory and on disk.
  Future<void> clear() async {
    _totals.clear();
    _days.clear();
    _since = null;
    _saveDebounce?.cancel();
    await deleteDoc(_docName);
  }

  /// Drop daily buckets older than [_maxDays] so the file can't grow unbounded.
  void _pruneDays() {
    if (_days.length <= _maxDays) return;
    final cutoff = _dayKey(DateTime.now().subtract(Duration(days: _maxDays)));
    _days.removeWhere((day, _) => day.compareTo(cutoff) < 0);
  }

  void _scheduleSave() {
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(seconds: 2), _save);
  }

  Future<void> _save() async {
    try {
      await writeDoc(
        _docName,
        jsonEncode({
          'since': (_since ?? DateTime.now()).toIso8601String(),
          'totals': _totals,
          'days': _days,
        }),
      );
    } catch (_) {
      /* best-effort */
    }
  }

  @visibleForTesting
  static String dayKeyForTest(DateTime d) => _dayKey(d);

  static String _dayKey(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
