import 'package:flutter/material.dart';
import '../models/message.dart';

/// WhatsApp-style delivery ticks: a clock while sending, one tick when it
/// reaches the server, two when delivered, two blue when read.
class ReceiptTicks extends StatelessWidget {
  final MessageStatus? status;
  final double size;
  final Color? color;

  const ReceiptTicks({super.key, required this.status, this.size = 16, this.color});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = color ?? scheme.onSurfaceVariant;
    switch (status) {
      case MessageStatus.sending:
        return Icon(Icons.schedule_rounded, size: size, color: base);
      case MessageStatus.failed:
        return Icon(Icons.error_outline_rounded,
            size: size, color: scheme.error);
      case MessageStatus.sent:
        return Icon(Icons.done_rounded, size: size, color: base);
      case MessageStatus.delivered:
        return Icon(Icons.done_all_rounded, size: size, color: base);
      case MessageStatus.read:
        return Icon(Icons.done_all_rounded,
            size: size, color: const Color(0xFF34B7F1));
      case null:
        return const SizedBox.shrink();
    }
  }
}
