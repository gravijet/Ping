import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';

/// Visual style (icon + colour + label) for a changelog entry's change type.
({IconData icon, Color color, String label}) _tagStyle(String tag) {
  switch (tag) {
    case 'feature':
      return (icon: Icons.auto_awesome_rounded, color: const Color(0xFF22C55E), label: 'Neu');
    case 'improvement':
      return (icon: Icons.trending_up_rounded, color: const Color(0xFF3B82F6), label: 'Verbessert');
    case 'fix':
      return (icon: Icons.build_rounded, color: const Color(0xFFF59E0B), label: 'Behoben');
    case 'security':
      return (icon: Icons.shield_rounded, color: const Color(0xFFEF4444), label: 'Sicherheit');
    default:
      return (icon: Icons.fiber_new_rounded, color: const Color(0xFF64748B), label: '');
  }
}

/// Renders a list of changelog entries (as returned by [AppState.changelogFor])
/// with a coloured change-type icon, title and summary.
class ChangelogList extends StatelessWidget {
  final List<Map<String, dynamic>> entries;
  const ChangelogList({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final e in entries)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 7),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                () {
                  final s = _tagStyle((e['tag'] ?? '').toString());
                  return Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: s.color.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(s.icon, color: s.color, size: 19),
                  );
                }(),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text((e['title'] ?? '').toString(),
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      if ((e['summary'] ?? '').toString().trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text((e['summary']).toString(),
                              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Fetch the changelog for [version] and, if there is anything to show, present
/// a "Was ist neu" sheet. Used right after the app updates to a new version.
Future<void> showWhatsNewSheet(BuildContext context, {required String version}) async {
  final entries = await context.read<AppState>().changelogFor(version);
  if (entries.isEmpty || !context.mounted) return;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _WhatsNewSheet(version: version, entries: entries),
  );
}

class _WhatsNewSheet extends StatelessWidget {
  final String version;
  final List<Map<String, dynamic>> entries;
  const _WhatsNewSheet({required this.version, required this.entries});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [scheme.primary, scheme.tertiary]),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.celebration_rounded, color: Colors.white, size: 32),
            ),
            const SizedBox(height: 14),
            const Text('Was ist neu',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('Version $version',
                style: TextStyle(color: scheme.onSurfaceVariant)),
            const SizedBox(height: 14),
            Flexible(
              child: SingleChildScrollView(
                child: ChangelogList(entries: entries),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(context).maybePop(),
                child: const Text("Los geht's"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
