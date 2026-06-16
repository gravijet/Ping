import 'package:shared_preferences/shared_preferences.dart';

// Web implementation: documents live in localStorage (shared_preferences),
// keyed by name. Plenty for a session-oriented second screen.

const _prefix = 'pingdoc:';

Future<String?> readDoc(String name) async {
  try {
    final p = await SharedPreferences.getInstance();
    return p.getString('$_prefix$name');
  } catch (_) {
    return null;
  }
}

Future<void> writeDoc(String name, String contents) async {
  try {
    final p = await SharedPreferences.getInstance();
    await p.setString('$_prefix$name', contents);
  } catch (_) {
    /* best-effort */
  }
}

Future<void> deleteDoc(String name) async {
  try {
    final p = await SharedPreferences.getInstance();
    await p.remove('$_prefix$name');
  } catch (_) {
    /* ignore */
  }
}

/// Delete every document whose name starts with [prefix].
Future<void> deletePrefix(String prefix) async {
  try {
    final p = await SharedPreferences.getInstance();
    final keys =
        p.getKeys().where((k) => k.startsWith('$_prefix$prefix')).toList();
    for (final k in keys) {
      await p.remove(k);
    }
  } catch (_) {
    /* ignore */
  }
}
