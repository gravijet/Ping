import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';
import '../widgets/editable_avatar.dart';

/// Shown once, right after a brand-new account is created: pick a name, photo,
/// colour and bio before landing in the app.
class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  late final TextEditingController _name;
  late final TextEditingController _about;
  late String _color;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final me = context.read<AppState>().me;
    // Don't prefill the name with the phone number — start blank so it's clear
    // they should enter a real name.
    _name = TextEditingController(text: me != null && me.hasName ? me.displayName : '');
    _about = TextEditingController(text: me?.about ?? '');
    _color = me?.avatarColor ?? kAvatarPalette.first;
  }

  @override
  void dispose() {
    _name.dispose();
    _about.dispose();
    super.dispose();
  }

  Color get _currentColor =>
      Color(int.parse('FF${_color.replaceFirst('#', '')}', radix: 16));

  Future<void> _finish() async {
    final state = context.read<AppState>();
    final name = _name.text.trim();
    setState(() => _saving = true);
    try {
      // Only send a name if they entered one; otherwise keep the default.
      await state.updateProfile(
        displayName: name.isEmpty ? null : name,
        about: _about.text.trim(),
        avatarColor: _color,
      );
      state.finishProfileSetup();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final me = state.me;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profil einrichten'),
        actions: [
          TextButton(
            onPressed: _saving ? null : () => state.finishProfileSetup(),
            child: const Text('Überspringen'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const SizedBox(height: 8),
          Center(child: EditableAvatar(color: _currentColor, size: 116)),
          const SizedBox(height: 10),
          if (me != null)
            Center(
              child: Text(
                me.phone,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ),
          const SizedBox(height: 24),
          TextField(
            controller: _name,
            maxLength: 40,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Dein Name',
              hintText: 'Wie sollen andere dich sehen?',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _about,
            maxLength: 140,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Über mich (optional)',
              hintText: 'Erzähl kurz etwas über dich …',
              prefixIcon: Icon(Icons.info_outline_rounded),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          Text('Avatarfarbe', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 12),
          _ColorPicker(
            selected: _color,
            onSelect: (c) => setState(() => _color = c),
          ),
          const SizedBox(height: 28),
          FilledButton(
            onPressed: _saving ? null : _finish,
            child: _saving
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: Colors.white),
                  )
                : const Text('Los geht’s'),
          ),
        ],
      ),
    );
  }
}

class _ColorPicker extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;
  const _ColorPicker({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: kAvatarPalette.map((hex) {
        final c = Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));
        final isSelected = hex == selected;
        return GestureDetector(
          onTap: () => onSelect(hex),
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: c,
              shape: BoxShape.circle,
              border: isSelected
                  ? Border.all(
                      color: Theme.of(context).colorScheme.onSurface, width: 3)
                  : null,
            ),
            child: isSelected
                ? const Icon(Icons.check_rounded, color: Colors.white)
                : null,
          ),
        );
      }).toList(),
    );
  }
}
