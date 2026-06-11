import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';

/// A hidden, fully local "debug" chat reached by starting a conversation with
/// `*0111`. It never talks to the message API — you type commands and a local
/// bot answers with non-sensitive diagnostics. Typing `/` shows live command
/// suggestions; admins get an extra set of management commands.
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
  final _focus = FocusNode();
  final List<_DebugLine> _lines = [];
  bool _busy = false;
  List<DebugCommand> _suggestions = const [];

  @override
  void initState() {
    super.initState();
    _lines.add(_DebugLine(
      'Debug-Konsole. Tippe „/" für Vorschläge oder /help für alle Befehle.',
      false,
    ));
    _input.addListener(_updateSuggestions);
  }

  @override
  void dispose() {
    _input.removeListener(_updateSuggestions);
    _input.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// Recompute the autocomplete list from the current input. Suggestions appear
  /// while the user is typing the command word (before the first space).
  void _updateSuggestions() {
    final text = _input.text;
    final all = context.read<AppState>().debugCommands;
    List<DebugCommand> next;
    if (!text.startsWith('/') || text.contains(' ')) {
      next = const [];
    } else {
      final q = text.toLowerCase();
      next = all
          .where((c) => c.name.startsWith(q) || q == '/')
          .toList(growable: false);
    }
    if (next.length != _suggestions.length ||
        !_listEquals(next, _suggestions)) {
      setState(() => _suggestions = next);
    }
  }

  bool _listEquals(List<DebugCommand> a, List<DebugCommand> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].name != b[i].name) return false;
    }
    return true;
  }

  void _applySuggestion(DebugCommand cmd) {
    // Fill the command; leave a trailing space when it expects an argument so
    // the user can keep typing.
    final hasArg = cmd.usage.contains('<');
    final filled = hasArg ? '${cmd.name} ' : cmd.name;
    _input.value = TextEditingValue(
      text: filled,
      selection: TextSelection.collapsed(offset: filled.length),
    );
    setState(() => _suggestions = const []);
    _focus.requestFocus();
    if (!hasArg) _send();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    _input.clear();
    setState(() {
      _lines.add(_DebugLine(text, true));
      _busy = true;
      _suggestions = const [];
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
          if (_suggestions.isNotEmpty) _suggestionBar(scheme),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      focusNode: _focus,
                      autocorrect: false,
                      enableSuggestions: false,
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

  Widget _suggestionBar(ColorScheme scheme) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 224),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        border: Border(
            top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.4))),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        itemCount: _suggestions.length,
        itemBuilder: (_, i) {
          final c = _suggestions[i];
          return ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            leading: Icon(
              c.adminOnly
                  ? Icons.admin_panel_settings_rounded
                  : Icons.terminal_rounded,
              size: 20,
              color: c.adminOnly ? scheme.tertiary : scheme.primary,
            ),
            title: Text(c.usage,
                style: const TextStyle(
                    fontFamily: 'monospace', fontWeight: FontWeight.w600)),
            subtitle: Text(c.description),
            onTap: () => _applySuggestion(c),
          );
        },
      ),
    );
  }

  Widget _bubble(_DebugLine line, ColorScheme scheme) {
    return Align(
      alignment: line.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () {
          Clipboard.setData(ClipboardData(text: line.text));
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Kopiert.'), duration: Duration(seconds: 1)));
        },
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
              color: line.mine ? scheme.onPrimaryContainer : scheme.onSurface,
              height: 1.35,
            ),
          ),
        ),
      ),
    );
  }
}
