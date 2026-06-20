import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/reminder.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/brand.dart';
import 'chat_screen.dart';

/// "Erinnerungen" — every message the user asked Ping to nudge them about.
/// Pending ones first (soonest due), then recently fired ("erledigt"). Reacts
/// live: a reminder firing over the socket moves itself into the fired group.
class RemindersScreen extends StatefulWidget {
  const RemindersScreen({super.key});

  @override
  State<RemindersScreen> createState() => _RemindersScreenState();
}

class _RemindersScreenState extends State<RemindersScreen> {
  @override
  void initState() {
    super.initState();
    // Refresh from the server on open (the list is also kept live by sockets).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AppState>().loadReminders();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: pingAppBar(context, title: const Text('Erinnerungen')),
      body: Consumer<AppState>(
        builder: (context, state, _) {
          final items = state.reminders;
          if (items.isEmpty) return _empty(context);
          return RefreshIndicator(
            onRefresh: () => state.loadReminders(),
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: items.length,
              separatorBuilder: (_, _) => Divider(
                height: 1,
                indent: 20,
                endIndent: 20,
                color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.3),
              ),
              itemBuilder: (context, i) => _ReminderTile(
                reminder: items[i],
                onRemove: () => state.deleteReminder(items[i].id),
                onOpen: () => _openChat(context, items[i]),
              ),
            ),
          );
        },
      ),
    );
  }

  void _openChat(BuildContext context, Reminder r) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ChatScreen(chatId: r.chatId)),
    );
  }

  Widget _empty(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.alarm_rounded, size: 64, color: scheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text('Keine Erinnerungen',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              'Halte eine Nachricht gedrückt und wähle „Erinnern“, '
              'um dich später daran erinnern zu lassen.',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReminderTile extends StatelessWidget {
  final Reminder reminder;
  final VoidCallback onRemove;
  final VoidCallback onOpen;

  const _ReminderTile({
    required this.reminder,
    required this.onRemove,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fired = reminder.fired;
    return Opacity(
      opacity: fired ? 0.6 : 1,
      child: ListTile(
        onTap: onOpen,
        leading: CircleAvatar(
          backgroundColor: fired
              ? scheme.surfaceContainerHighest
              : scheme.primaryContainer,
          foregroundColor: fired ? scheme.primary : scheme.onPrimaryContainer,
          child: Icon(fired ? Icons.check_rounded : Icons.alarm_rounded),
        ),
        title: Text(
          reminder.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${fired ? 'Erledigt · ' : ''}${TimeFormat.dateTime(reminder.remindTime)}'
          '${reminder.chatTitle.isNotEmpty ? ' · ${reminder.chatTitle}' : ''}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: fired ? scheme.onSurfaceVariant : scheme.primary,
          ),
        ),
        trailing: IconButton(
          tooltip: 'Entfernen',
          icon: const Icon(Icons.close_rounded),
          onPressed: onRemove,
        ),
      ),
    );
  }
}
