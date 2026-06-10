import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';

/// Backup & export. The server keeps automatic daily snapshots of the whole
/// database; here a user can also export their own account + chat history to a
/// JSON file on the device.
class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  bool _busy = false;
  String? _lastPath;

  Future<void> _export() async {
    setState(() => _busy = true);
    try {
      final path = await context.read<AppState>().exportDataToFile();
      if (!mounted) return;
      setState(() => _lastPath = path);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Backup gespeichert.')),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Backup fehlgeschlagen.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Backup')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.cloud_done_rounded, color: scheme.primary),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      'Automatische tägliche Sicherung\n'
                      'Der Server erstellt jeden Tag eine vollständige '
                      'Sicherung und bewahrt die letzten 14 auf.',
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Eigene Daten exportieren',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'Lade dein Konto und deinen kompletten Chat-Verlauf als JSON-Datei '
            'auf dieses Gerät. So hast du jederzeit eine eigene Kopie.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy ? null : _export,
            icon: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.2, color: Colors.white))
                : const Icon(Icons.download_rounded),
            label: Text(_busy ? 'Exportiere …' : 'Backup erstellen'),
          ),
          if (_lastPath != null) ...[
            const SizedBox(height: 16),
            ListTile(
              tileColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
              leading: const Icon(Icons.insert_drive_file_rounded),
              title: const Text('Letztes Backup'),
              subtitle: Text(_lastPath!.split('/').last),
              trailing: IconButton(
                icon: const Icon(Icons.open_in_new_rounded),
                onPressed: () => launchUrl(Uri.file(_lastPath!),
                    mode: LaunchMode.externalApplication),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
