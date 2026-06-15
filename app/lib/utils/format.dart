import 'package:intl/intl.dart';

/// Human, German-language time formatting used across the app.
class TimeFormat {
  /// Clock style, driven by the user's setting. AppState updates this whenever
  /// the settings load or change; formatting helpers read it so the whole app
  /// switches between 24-hour and 12-hour time at once.
  static bool clock24h = true;

  static final _weekday = DateFormat('EEEE', 'de');
  static final _dayMonth = DateFormat('d. MMM', 'de');
  static final _full = DateFormat('d. MMM yyyy', 'de');

  /// Short clock time honouring the user's 12h/24h preference. Built by hand for
  /// the 12-hour case so it never depends on per-locale `intl` data being loaded
  /// (only the German locale is initialised at startup).
  static String _clock(DateTime t) {
    String two(int n) => n.toString().padLeft(2, '0');
    if (clock24h) return '${two(t.hour)}:${two(t.minute)}';
    final period = t.hour < 12 ? 'AM' : 'PM';
    var h = t.hour % 12;
    if (h == 0) h = 12;
    return '$h:${two(t.minute)} $period';
  }

  /// Short label for a chat-list row: time today, "Gestern", weekday this week,
  /// or a date.
  static String chatStamp(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(t.year, t.month, t.day);
    final diff = today.difference(that).inDays;
    if (diff == 0) return _clock(t);
    if (diff == 1) return 'Gestern';
    if (diff < 7) return _weekday.format(t);
    if (t.year == now.year) return _dayMonth.format(t);
    return _full.format(t);
  }

  static String messageTime(DateTime t) => _clock(t);

  /// A friendly absolute date + time, e.g. "heute, 14:05", "morgen, 09:00" or
  /// "14. Jun, 18:30" — used for scheduled-message labels.
  static String dateTime(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(t.year, t.month, t.day);
    final diff = that.difference(today).inDays;
    final String datePart;
    if (diff == 0) {
      datePart = 'heute';
    } else if (diff == 1) {
      datePart = 'morgen';
    } else if (t.year == now.year) {
      datePart = _dayMonth.format(t);
    } else {
      datePart = _full.format(t);
    }
    return '$datePart, ${_clock(t)}';
  }

  /// Date + time for the message-info sheet, e.g. "3. Jun, 14:05".
  static String receiptStamp(int? ms) {
    if (ms == null) return '—';
    final t = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    final datePart = t.year == now.year ? _dayMonth.format(t) : _full.format(t);
    return '$datePart, ${_clock(t)}';
  }

  /// Date divider shown between groups of messages.
  static String dayDivider(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(t.year, t.month, t.day);
    final diff = today.difference(that).inDays;
    if (diff == 0) return 'Heute';
    if (diff == 1) return 'Gestern';
    if (diff < 7) return _weekday.format(t);
    return _full.format(t);
  }

  /// "zuletzt online …" style presence label.
  static String lastSeen(int? ms) {
    if (ms == null) return 'zuletzt unbekannt';
    final t = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    final diff = now.difference(t);
    if (diff.inMinutes < 1) return 'gerade eben online';
    if (diff.inMinutes < 60) return 'zuletzt vor ${diff.inMinutes} Min.';
    if (diff.inHours < 24 && now.day == t.day) {
      return 'zuletzt um ${_clock(t)}';
    }
    if (diff.inDays == 1) return 'zuletzt gestern um ${_clock(t)}';
    return 'zuletzt am ${_dayMonth.format(t)}';
  }
}
