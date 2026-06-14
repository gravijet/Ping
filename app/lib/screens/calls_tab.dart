import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/call.dart';
import '../services/app_state.dart';
import '../utils/format.dart';
import '../widgets/avatar.dart';
import '../widgets/verified_badge.dart';

/// The "Anrufe" tab: the call history with call-back actions, like the recents
/// list in a phone dialer.
class CallsTab extends StatelessWidget {
  const CallsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final calls = state.calls;

    return RefreshIndicator(
      onRefresh: state.loadCalls,
      child: calls.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.18),
                Icon(Icons.call_rounded,
                    size: 84, color: scheme.primary.withValues(alpha: 0.5)),
                const SizedBox(height: 18),
                Text('Noch keine Anrufe',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 48),
                  child: Text(
                    'Starte einen Sprach- oder Videoanruf aus einem Chat — '
                    'er erscheint dann hier.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 96, top: 4),
              itemCount: calls.length,
              separatorBuilder: (_, _) => Divider(
                indent: 84,
                endIndent: 16,
                height: 1,
                color: scheme.outlineVariant.withValues(alpha: 0.3),
              ),
              itemBuilder: (_, i) => _CallTile(state: state, call: calls[i]),
            ),
    );
  }
}

class _CallTile extends StatelessWidget {
  final AppState state;
  final CallEntry call;
  const _CallTile({required this.state, required this.call});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final missed = call.missed;
    final color = missed ? scheme.error : scheme.onSurfaceVariant;
    final icon = missed
        ? Icons.call_missed_rounded
        : (call.incoming
            ? Icons.call_received_rounded
            : Icons.call_made_rounded);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: PingAvatar(
        initials: call.peer.initials,
        color: call.peer.color,
        size: 48,
        imageUrl: state.avatarUrl(call.peer),
        imageHeaders: state.authHeaders,
      ),
      title: NameWithBadge(
        name: call.peer.label,
        user: call.peer,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: missed ? scheme.error : null,
        ),
      ),
      subtitle: Row(
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              _subtitle(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: color, fontSize: 12.5),
            ),
          ),
        ],
      ),
      trailing: IconButton(
        tooltip: call.video ? 'Videoanruf' : 'Sprachanruf',
        icon: Icon(
          call.video ? Icons.videocam_rounded : Icons.call_rounded,
          color: scheme.primary,
        ),
        onPressed: () => _callBack(context, video: call.video),
      ),
      onTap: () => _showActions(context),
      onLongPress: () => _showActions(context),
    );
  }

  String _subtitle() {
    final when = TimeFormat.messageTime(
        DateTime.fromMillisecondsSinceEpoch(call.createdAt));
    final label = switch (call.outcome) {
      'missed' => 'Verpasst',
      'declined' => call.incoming ? 'Abgelehnt' : 'Keine Antwort',
      'canceled' => 'Abgebrochen',
      'failed' => 'Fehlgeschlagen',
      _ => call.duration > 0 ? _duration(call.duration) : 'Verbunden',
    };
    return '$label · $when';
  }

  static String _duration(int seconds) {
    final m = (seconds ~/ 60).toString();
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Future<void> _callBack(BuildContext context, {required bool video}) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await state.startCall(call.peer, video: video);
    } catch (_) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Anruf konnte nicht gestartet werden. '
            'Prüfe die Kamera-/Mikrofon-Berechtigung.'),
      ));
    }
  }

  void _showActions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.call_rounded),
              title: Text('${call.peer.label} anrufen'),
              onTap: () {
                Navigator.pop(ctx);
                _callBack(context, video: false);
              },
            ),
            ListTile(
              leading: const Icon(Icons.videocam_rounded),
              title: const Text('Videoanruf starten'),
              onTap: () {
                Navigator.pop(ctx);
                _callBack(context, video: true);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded),
              title: const Text('Aus Verlauf entfernen'),
              onTap: () {
                Navigator.pop(ctx);
                state.deleteCall(call.id);
              },
            ),
          ],
        ),
      ),
    );
  }
}
