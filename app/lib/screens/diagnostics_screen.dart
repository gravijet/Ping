import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/crash_service.dart';
import '../widgets/brand.dart';

/// "Diagnose" — a human-readable view of the on-device crash/error log captured
/// by [CrashService]. Everything here is stored **only on this phone**; nothing
/// is ever uploaded. The user can copy or e-mail a report to support, or wipe
/// the log entirely.
class DiagnosticsScreen extends StatefulWidget {
  const DiagnosticsScreen({super.key});

  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  CrashService get _crash => CrashService.instance;

  Future<void> _copyAll() async {
    await Clipboard.setData(ClipboardData(text: _crash.exportText()));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Diagnosebericht kopiert.')));
  }

  Future<void> _emailAll() async {
    final uri = Uri(
      scheme: 'mailto',
      path: 'user@example.invalid',
      query: _encodeQuery({
        'subject': 'Ping Diagnosebericht',
        'body': _crash.exportText(),
      }),
    );
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('no handler');
    } catch (_) {
      // No mail app — fall back to the clipboard so the report isn't lost.
      await _copyAll();
    }
  }

  Future<void> _clear() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Berichte löschen?'),
        content: const Text(
            'Alle gespeicherten Fehlerberichte werden dauerhaft entfernt.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Löschen'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _crash.clear();
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final reports = _crash.reports;
    return Scaffold(
      appBar: pingAppBar(
        context,
        title: const Text('Diagnose'),
        actions: [
          if (reports.isNotEmpty)
            PopupMenuButton<String>(
              onSelected: (v) {
                switch (v) {
                  case 'copy':
                    _copyAll();
                  case 'email':
                    _emailAll();
                  case 'clear':
                    _clear();
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'copy', child: Text('Kopieren')),
                PopupMenuItem(value: 'email', child: Text('Per E-Mail senden')),
                PopupMenuItem(value: 'clear', child: Text('Alle löschen')),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          _PrivacyNote(scheme: scheme),
          Expanded(
            child: reports.isEmpty
                ? _empty(scheme)
                : ListView.separated(
                    padding: const EdgeInsets.only(bottom: 24),
                    itemCount: reports.length,
                    separatorBuilder: (_, _) =>
                        Divider(height: 1, color: scheme.outlineVariant
                            .withValues(alpha: 0.3)),
                    itemBuilder: (context, i) =>
                        _ReportTile(report: reports[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _empty(ColorScheme scheme) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.verified_outlined,
                  size: 64, color: scheme.primary.withValues(alpha: 0.7)),
              const SizedBox(height: 16),
              Text('Keine Fehlerberichte',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(
                'Alles läuft rund. Sollte Ping einmal abstürzen, taucht hier '
                'ein technischer Bericht auf — nur auf diesem Gerät.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      );

  /// Encode a mailto query, escaping spaces/newlines so subject + body survive.
  static String _encodeQuery(Map<String, String> params) => params.entries
      .map((e) =>
          '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
      .join('&');
}

class _PrivacyNote extends StatelessWidget {
  final ColorScheme scheme;
  const _PrivacyNote({required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(Icons.lock_outline_rounded, size: 20, color: scheme.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Diese Berichte bleiben auf deinem Gerät. Sie werden nie '
              'automatisch gesendet; Telefonnummern und Tokens sind entfernt.',
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReportTile extends StatelessWidget {
  final CrashReport report;
  const _ReportTile({required this.report});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = report.fatal ? scheme.error : scheme.tertiary;
    return Theme(
      // Drop the default ExpansionTile divider lines for a cleaner list.
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        leading: Icon(
          report.fatal
              ? Icons.error_outline_rounded
              : Icons.warning_amber_rounded,
          color: color,
        ),
        title: Text(
          report.headline,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        ),
        subtitle: Text(
          '${DateFormat('dd.MM.yyyy HH:mm:ss').format(report.time)}'
          ' · v${report.version}'
          '${report.context != null ? ' · ${report.context}' : ''}',
          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(12),
            ),
            child: SelectableText(
              '${report.error}\n\n${report.stack}'.trim(),
              style: const TextStyle(
                  fontFamily: 'monospace', fontSize: 11.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
