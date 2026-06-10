import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';

/// A hidden, fully local "debug" chat reached by starting a conversation with
/// `*0111`. It never talks to the message API — you type commands and a local
/// bot answers with non-sensitive diagnostics. Handy for support.
class DebugChatScreen extends StatefulWidget {
  const DebugChatScreen({super.key});

  @override
  State<DebugChatScreen> createState() => _DebugChatScreenState();
}

class _DebugLine {
  final String text;
  final bool mine;
  _DebugLine(this.text, this.mine);
}

class _DebugChatScreenState extends State<DebugChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_DebugLine> _lines = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _lines.add(_DebugLine(
      'Debug-Konsole. Tippe /help für die Liste der Befehle.',
      false,
    ));
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    _input.clear();
    setState(() {
      _lines.add(_DebugLine(text, true));
      _busy = true;
    });
    _scrollDown();
    final reply = await context.read<AppState>().debugCommand(text);
    if (!mounted) return;
    setState(() {
      _lines.add(_DebugLine(reply, false));
      _busy = false;
    });
    _scrollDown();
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.bug_report_rounded),
            SizedBox(width: 10),
            Text('debug'),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(12),
              itemCount: _lines.length,
              itemBuilder: (_, i) => _bubble(_lines[i], scheme),
            ),
          ),
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      autocorrect: false,
                      onSubmitted: (_) => _send(),
                      decoration: const InputDecoration(
                        hintText: 'Befehl … (/help)',
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Material(
                    color: scheme.primary,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: _send,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Icon(Icons.send_rounded,
                            color: scheme.onPrimary, size: 22),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble(_DebugLine line, ColorScheme scheme) {
    return Align(
      alignment: line.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.82),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: line.mine
              ? scheme.primaryContainer
              : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          line.text,
          style: TextStyle(
            fontFamily: line.mine ? null : 'monospace',
            color: line.mine
                ? scheme.onPrimaryContainer
                : scheme.onSurface,
            height: 1.35,
          ),
        ),
      ),
    );
  }
}
