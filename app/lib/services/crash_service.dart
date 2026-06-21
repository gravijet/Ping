import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'doc_store.dart';

/// A single captured error: enough to debug it later, nothing that identifies a
/// person. Reports are always kept **on the device**; a redacted copy is also
/// forwarded to the developer bug inbox when error reporting is enabled (see
/// [CrashService.sender]).
@immutable
class CrashReport {
  final DateTime time;
  final String version; // app version+build at the time of the crash
  final String error; // the exception's toString(), redacted
  final String stack; // truncated, redacted stack trace
  final String? context; // a human label for where it happened (route, action)
  final bool fatal; // true = an uncaught error reached a guard zone

  const CrashReport({
    required this.time,
    required this.version,
    required this.error,
    required this.stack,
    this.context,
    this.fatal = false,
  });

  /// A short one-line headline for the list (first line of the error).
  String get headline {
    final firstLine = error.split('\n').first.trim();
    return firstLine.isEmpty ? 'Unbekannter Fehler' : firstLine;
  }

  Map<String, dynamic> toJson() => {
        't': time.toIso8601String(),
        'v': version,
        'e': error,
        's': stack,
        if (context != null) 'c': context,
        'f': fatal,
      };

  factory CrashReport.fromJson(Map<String, dynamic> j) => CrashReport(
        time: DateTime.tryParse(j['t'] as String? ?? '')?.toLocal() ??
            DateTime.now(),
        version: (j['v'] as String?) ?? '?',
        error: (j['e'] as String?) ?? '',
        stack: (j['s'] as String?) ?? '',
        context: j['c'] as String?,
        fatal: j['f'] == true,
      );
}

/// Forwards a redacted crash payload to the server bug inbox
/// (POST /api/client-error). Returns a future that completes when the report has
/// been sent (or quietly dropped). Wired in `main.dart`.
typedef CrashSender = Future<void> Function(Map<String, dynamic> payload);

/// Privacy-first crash & error capture for the Android app.
///
/// It keeps a small ring buffer of the most recent errors in the app's
/// documents directory and shows them under *Einstellungen → Diagnose*. Obvious
/// personal data (phone numbers, tokens) is redacted before anything leaves the
/// `record` call. A redacted copy of each new report is also forwarded to the
/// developer bug inbox via [sender] when one is wired and the 'errorReporting'
/// flag is on — so real crashes reach the developer (and a fresh Claude session)
/// instead of dying on the device. The forward is best-effort and de-duplicated
/// per session; the on-device log is the source of truth.
///
/// Wiring (see `main.dart`): [install] hooks Flutter's framework errors and the
/// platform dispatcher's uncaught errors; [guard] runs the app inside a guarded
/// zone so asynchronous errors are captured too; [sender] is attached once the
/// app's API client exists.
class CrashService {
  CrashService._();
  static final CrashService instance = CrashService._();

  static const _docName = 'diagnostics/crashes.json';
  static const _maxReports = 50;
  static const _maxStackChars = 4000;

  final List<CrashReport> _reports = [];
  String _version = '?';
  bool _loaded = false;
  bool _installed = false;
  Timer? _saveDebounce;

  /// Optional sink that forwards a redacted copy of each new report to the dev
  /// bug inbox. Wired in `main.dart` and gated there by the 'errorReporting'
  /// flag; while null (tests, pre-bootstrap) capture stays purely on-device.
  CrashSender? sender;
  // Headlines already forwarded this session, so a tight error loop sends each
  // distinct crash once (the server de-dups the rest by fingerprint anyway).
  final Set<String> _sent = {};

  /// The captured reports, newest first. Safe to read from the UI.
  List<CrashReport> get reports => List.unmodifiable(_reports);

  bool get isEmpty => _reports.isEmpty;
  int get count => _reports.length;

  /// Tag every future report with the running app version+build.
  set version(String v) => _version = v;

  /// Hook the framework + platform error channels exactly once. Existing handlers
  /// (e.g. Flutter's red-screen builder) keep running afterwards.
  void install() {
    if (_installed) return;
    _installed = true;

    final prevOnError = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      record(details.exception, details.stack,
          context: details.context?.toString(), fatal: false);
      // Preserve the default behaviour (red error box in debug, logging).
      prevOnError?.call(details);
    };

    // Uncaught errors that bubble to the engine (e.g. from platform callbacks).
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      record(error, stack, context: 'PlatformDispatcher', fatal: true);
      return false; // let the framework keep its own logging
    };
  }

  /// Run [body] inside a guarded zone so async errors are captured too. Returns
  /// whatever the zone produces; on a fatal error the app keeps running.
  R? guard<R>(R Function() body) {
    return runZonedGuarded<R>(
      body,
      (error, stack) => record(error, stack, context: 'Zone', fatal: true),
    );
  }

  /// Capture one error. Best-effort and never throws — a failure here must not
  /// cascade into another crash.
  void record(Object error, StackTrace? stack,
      {String? context, bool fatal = false}) {
    try {
      final report = CrashReport(
        time: DateTime.now(),
        version: _version,
        error: _redact(error.toString()),
        stack: _redact(_truncate(stack?.toString() ?? '')),
        context: context == null ? null : _redact(context),
        fatal: fatal,
      );
      _reports.insert(0, report);
      if (_reports.length > _maxReports) {
        _reports.removeRange(_maxReports, _reports.length);
      }
      _scheduleSave();
      _trySend(report);
    } catch (_) {
      /* never let the crash reporter crash */
    }
  }

  /// Best-effort forward of one report to [sender]. Never throws; sends each
  /// distinct error at most once per session. The fields mirror the server's
  /// clientErrorSchema (context ≤ 40, message ≤ 500, stack ≤ 4000 chars).
  void _trySend(CrashReport r) {
    final send = sender;
    if (send == null) return;
    final key = '${r.context ?? ''}|${r.headline}';
    if (!_sent.add(key)) return;
    if (_sent.length > 200) _sent.clear();
    try {
      final ctx = r.context;
      send({
        'app': 'android',
        'appVersion': r.version,
        if (ctx != null && ctx.isNotEmpty)
          'context': ctx.length > 40 ? ctx.substring(0, 40) : ctx,
        'message': r.error.length > 480 ? r.error.substring(0, 480) : r.error,
        'stack': r.stack.length > 3900 ? r.stack.substring(0, 3900) : r.stack,
      }).catchError((_) {});
    } catch (_) {
      /* a reporting failure must never cascade into another crash */
    }
  }

  /// Load any persisted reports from disk. Best-effort; safe before the first
  /// frame and in tests (a missing platform channel just yields no data).
  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final raw = await readDoc(_docName);
      if (raw == null || raw.isEmpty) return;
      final list = (jsonDecode(raw) as List)
          .whereType<Map>()
          .map((e) => CrashReport.fromJson(e.cast<String, dynamic>()))
          .toList();
      // Keep anything already captured during this session ahead of disk data.
      _reports.addAll(list);
      if (_reports.length > _maxReports) {
        _reports.removeRange(_maxReports, _reports.length);
      }
    } catch (_) {
      /* corrupt cache → start clean */
    }
  }

  /// Forget every stored report.
  Future<void> clear() async {
    _reports.clear();
    _saveDebounce?.cancel();
    await deleteDoc(_docName);
  }

  /// A plain-text dump of all reports, suitable for the share sheet / clipboard.
  String exportText() {
    final b = StringBuffer()
      ..writeln('Ping — Diagnosebericht')
      ..writeln('App-Version: $_version')
      ..writeln('Erstellt: ${DateTime.now().toIso8601String()}')
      ..writeln('Berichte: ${_reports.length}')
      ..writeln('—' * 32);
    for (final r in _reports) {
      b
        ..writeln()
        ..writeln('[${r.time.toIso8601String()}] '
            '${r.fatal ? 'FATAL' : 'WARN'} '
            '${r.context ?? ''}'.trim())
        ..writeln('v${r.version}')
        ..writeln(r.error)
        ..writeln(r.stack);
    }
    return b.toString();
  }

  void _scheduleSave() {
    // Coalesce bursts of errors into a single write.
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(milliseconds: 600), _save);
  }

  Future<void> _save() async {
    try {
      final data = jsonEncode(_reports.map((r) => r.toJson()).toList());
      await writeDoc(_docName, data);
    } catch (_) {
      /* best-effort */
    }
  }

  static String _truncate(String s) =>
      s.length <= _maxStackChars ? s : '${s.substring(0, _maxStackChars)}\n…';

  /// Strip data that could identify a person before anything is written to disk:
  /// long digit runs (phone numbers), bearer/JWT-looking tokens, and obvious
  /// `Bearer …` / `token=…` fragments. Defensive, not exhaustive — but it keeps
  /// the on-device log free of the most sensitive accidental leaks.
  static String _redact(String input) {
    var s = input;
    // Bearer tokens / Authorization headers (keep the label, drop the secret).
    s = s.replaceAllMapped(
        RegExp(r'(bearer\s+)[A-Za-z0-9._\-]+', caseSensitive: false),
        (m) => '${m[1]}‹redacted›');
    s = s.replaceAllMapped(
        RegExp(r'(authorization"?\s*[:=]\s*"?)[^",\s]+', caseSensitive: false),
        (m) => '${m[1]}‹redacted›');
    // token=… / password=… / secret=…
    s = s.replaceAllMapped(
        RegExp(r'((?:token|password|pass|secret)"?\s*[:=]\s*"?)[^",\s&]+',
            caseSensitive: false),
        (m) => '${m[1]}‹redacted›');
    // JWT-ish triplets.
    s = s.replaceAll(
        RegExp(r'\b[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b'),
        '‹token›');
    // Phone-number-like runs of 7+ digits (optionally + and separators).
    s = s.replaceAll(RegExp(r'\+?\d[\d\s\-]{6,}\d'), '‹number›');
    return s;
  }
}
