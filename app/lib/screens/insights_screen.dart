import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
// Hide intl's TextDirection so the CustomPainter below resolves the dart:ui one
// (with `.ltr`) that TextPainter expects.
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/metrics_service.dart';
import '../widgets/brand.dart';

/// "Deine Statistik" — a private, on-device summary of how you use Ping. It is
/// **opt-in**: until you turn it on, nothing is counted. Even when on, it only
/// ever stores integer tallies of your own actions (never content, contacts, or
/// an identifier), and a single tap erases all of it.
class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  // Which metric the 7-day chart visualises.
  String _chartMetric = MetricKeys.messagesSent;

  Future<void> _setEnabled(AppState state, bool value) async {
    await state.updateSettings(state.settings.copyWith(collectMetrics: value));
    if (mounted) setState(() {});
  }

  Future<void> _reset(AppState state) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Statistik zurücksetzen?'),
        content: const Text('Alle Zähler werden auf null gesetzt.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Abbrechen')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Zurücksetzen'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await state.metrics.clear();
      if (mounted) setState(() {});
    }
  }

  Future<void> _share(AppState state) async {
    final m = state.metrics;
    final b = StringBuffer('Meine Ping-Statistik 📊\n');
    for (final key in MetricKeys.all) {
      b.writeln('• ${MetricKeys.labels[key]}: ${m.total(key)}');
    }
    await Clipboard.setData(ClipboardData(text: b.toString().trim()));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Statistik in die Zwischenablage kopiert.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final enabled = state.settings.collectMetrics;
    return Scaffold(
      appBar: pingAppBar(context, title: const Text('Deine Statistik')),
      body: enabled ? _enabledBody(state) : _disabledBody(state),
    );
  }

  // ---- Opt-in gate ---------------------------------------------------------

  Widget _disabledBody(AppState state) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SizedBox(height: 16),
        Icon(Icons.insights_rounded, size: 72, color: scheme.primary),
        const SizedBox(height: 20),
        Text('Wie nutzt du Ping?',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        Text(
          'Ping kann mitzählen, wie viele Nachrichten du sendest, Chats du '
          'öffnest und Anrufe du startest — komplett auf diesem Gerät. '
          'Es werden nur Zahlen gespeichert, niemals Inhalte oder Kontakte, '
          'und nichts wird übertragen.',
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant, height: 1.4),
        ),
        const SizedBox(height: 28),
        FilledButton.icon(
          icon: const Icon(Icons.play_arrow_rounded),
          label: const Text('Statistik aktivieren'),
          onPressed: () => _setEnabled(state, true),
        ),
      ],
    );
  }

  // ---- Active dashboard ----------------------------------------------------

  Widget _enabledBody(AppState state) {
    final scheme = Theme.of(context).colorScheme;
    final m = state.metrics;
    final since = m.since;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        // Headline: total actions counted.
        _HeadlineCard(
          total: m.grandTotal,
          since: since,
        ),
        const SizedBox(height: 16),
        // 7-day chart with a metric selector.
        Text('Letzte 7 Tage',
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            for (final key in const [
              MetricKeys.messagesSent,
              MetricKeys.chatsOpened,
              MetricKeys.callsStarted,
            ])
              ChoiceChip(
                label: Text(MetricKeys.labels[key]!),
                selected: _chartMetric == key,
                onSelected: (_) => setState(() => _chartMetric = key),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 18, 12, 10),
            child: SizedBox(
              height: 160,
              child: _BarChart(
                values: m.series(_chartMetric, days: 7),
                color: scheme.primary,
                trackColor: scheme.onSurface.withValues(alpha: 0.06),
                labelColor: scheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text('Gesamt', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.9,
          children: [
            for (final key in MetricKeys.all)
              _StatCard(
                label: MetricKeys.labels[key]!,
                value: m.total(key),
                icon: _iconFor(key),
              ),
          ],
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          icon: const Icon(Icons.ios_share_rounded),
          label: const Text('Statistik teilen'),
          onPressed: () => _share(state),
        ),
        const SizedBox(height: 8),
        TextButton.icon(
          style: TextButton.styleFrom(foregroundColor: scheme.error),
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Zurücksetzen'),
          onPressed: () => _reset(state),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => _setEnabled(state, false),
          child: const Text('Erfassung ausschalten'),
        ),
      ],
    );
  }

  static IconData _iconFor(String key) => switch (key) {
        MetricKeys.messagesSent => Icons.send_rounded,
        MetricKeys.chatsOpened => Icons.chat_bubble_outline_rounded,
        MetricKeys.callsStarted => Icons.call_rounded,
        MetricKeys.photosSent => Icons.photo_outlined,
        MetricKeys.voiceSent => Icons.mic_none_rounded,
        MetricKeys.statusPosted => Icons.amp_stories_rounded,
        MetricKeys.appOpens => Icons.open_in_new_rounded,
        _ => Icons.bar_chart_rounded,
      };
}

class _HeadlineCard extends StatelessWidget {
  final int total;
  final DateTime? since;
  const _HeadlineCard({required this.total, this.since});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Icon(Icons.insights_rounded,
                size: 40, color: scheme.onPrimaryContainer),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$total',
                      style: Theme.of(context)
                          .textTheme
                          .headlineMedium
                          ?.copyWith(
                              color: scheme.onPrimaryContainer,
                              fontWeight: FontWeight.w800)),
                  Text(
                    since == null
                        ? 'Aktionen erfasst'
                        : 'Aktionen seit ${DateFormat('d. MMM yyyy', 'de').format(since!)}',
                    style: TextStyle(
                        color: scheme.onPrimaryContainer
                            .withValues(alpha: 0.85)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final int value;
  final IconData icon;
  const _StatCard(
      {required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Icon(icon, color: scheme.primary, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('$value',
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800)),
                  Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 11.5, color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A compact bar chart for a 7-day series, with weekday labels under each bar
/// and the value above the tallest one. Pure [CustomPaint] — no chart package.
class _BarChart extends StatelessWidget {
  final List<int> values;
  final Color color;
  final Color trackColor;
  final Color labelColor;
  const _BarChart({
    required this.values,
    required this.color,
    required this.trackColor,
    required this.labelColor,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _BarChartPainter(
        values: values,
        color: color,
        trackColor: trackColor,
        labelColor: labelColor,
        // Weekday initials for the last 7 days, oldest first.
        labels: List.generate(values.length, (i) {
          final d = DateTime.now()
              .subtract(Duration(days: values.length - 1 - i));
          return DateFormat('E', 'de').format(d).substring(0, 2);
        }),
      ),
      child: const SizedBox.expand(),
    );
  }
}

class _BarChartPainter extends CustomPainter {
  final List<int> values;
  final List<String> labels;
  final Color color;
  final Color trackColor;
  final Color labelColor;

  _BarChartPainter({
    required this.values,
    required this.labels,
    required this.color,
    required this.trackColor,
    required this.labelColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    const labelGap = 22.0; // room for the weekday labels at the bottom
    final chartH = size.height - labelGap;
    final maxV = values.fold<int>(0, (a, b) => b > a ? b : a);
    final slot = size.width / values.length;
    final barW = (slot * 0.5).clamp(6.0, 28.0);
    final radius = Radius.circular(barW / 2);

    final trackPaint = Paint()..color = trackColor;
    final barPaint = Paint()..color = color;

    for (var i = 0; i < values.length; i++) {
      final cx = slot * i + slot / 2;
      final left = cx - barW / 2;

      // Track (full-height faint pill behind each bar).
      canvas.drawRRect(
        RRect.fromRectAndRadius(
            Rect.fromLTWH(left, 0, barW, chartH), radius),
        trackPaint,
      );

      // Filled portion.
      final frac = maxV == 0 ? 0.0 : values[i] / maxV;
      final h = (chartH * frac).clamp(values[i] > 0 ? 4.0 : 0.0, chartH);
      if (h > 0) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(left, chartH - h, barW, h), radius),
          barPaint,
        );
      }

      // Value above the bar (only when there's something to show).
      if (values[i] > 0) {
        _text(canvas, '${values[i]}', cx, (chartH - h - 14).clamp(0.0, chartH),
            color: color, size: 11, bold: true);
      }

      // Weekday label.
      _text(canvas, labels.length > i ? labels[i] : '', cx,
          chartH + 6, color: labelColor, size: 11);
    }
  }

  void _text(Canvas canvas, String s, double cx, double top,
      {required Color color, required double size, bool bold = false}) {
    final tp = TextPainter(
      text: TextSpan(
        text: s,
        style: TextStyle(
          color: color,
          fontSize: size,
          fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(cx - tp.width / 2, top));
  }

  @override
  bool shouldRepaint(covariant _BarChartPainter old) =>
      old.values != values || old.color != color;
}
