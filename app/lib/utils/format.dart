import 'package:intl/intl.dart';

/// Human, German-language time formatting used across the app.
class TimeFormat {
  static final _time = DateFormat('HH:mm');
  static final _weekday = DateFormat('EEEE', 'de');
  static final _dayMonth = DateFormat('d. MMM', 'de');
  static final _full = DateFormat('d. MMM yyyy', 'de');

  /// Short label for a chat-list row: time today, "Gestern", weekday this week,
  /// or a date.
  static String chatStamp(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(t.year, t.month, t.day);
    final diff = today.difference(that).inDays;
    if (diff == 0) return _time.format(t);
    if (diff == 1) return 'Gestern';
    if (diff < 7) return _weekday.format(t);
    if (t.year == now.year) return _dayMonth.format(t);
    return _full.format(t);
  }

  static String messageTime(DateTime t) => _time.format(t);

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
    return '$datePart, ${_time.format(t)}';
  }

  /// Date + time for the message-info sheet, e.g. "3. Jun, 14:05".
  static String receiptStamp(int? ms) {
    if (ms == null) return '—';
    final t = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    final datePart = t.year == now.year ? _dayMonth.format(t) : _full.format(t);
    return '$datePart, ${_time.format(t)}';
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
      return 'zuletzt um ${_time.format(t)}';
    }
    if (diff.inDays == 1) return 'zuletzt gestern um ${_time.format(t)}';
    return 'zuletzt am ${_dayMonth.format(t)}';
  }
}
