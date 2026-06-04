import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import '../widgets/avatar.dart';

const _palette = [
  '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
  '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
  '#9CCC65', '#FFA726', '#FF7043', '#8D6E63', '#78909C',
];

class ProfileEditScreen extends StatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  State<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends State<ProfileEditScreen> {
  late TextEditingController _name;
  late TextEditingController _about;
  late String _color;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final me = context.read<AppState>().me!;
    _name = TextEditingController(text: me.displayName);
    _about = TextEditingController(text: me.about);
    _color = me.avatarColor;
  }

  @override
  void dispose() {
    _name.dispose();
    _about.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Dein Name darf nicht leer sein.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<AppState>().updateProfile(
            displayName: name,
            about: _about.text.trim(),
            avatarColor: _color,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profil gespeichert.')),
        );
        Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Color get _currentColor {
    final hex = _color.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AppState>().me!;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profil bearbeiten'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2))
                : const Text('Speichern'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Center(
            child: PingAvatar(
              initials: _name.text.trim().isEmpty
                  ? me.initials
                  : _name.text.trim()[0].toUpperCase(),
              color: _currentColor,
              size: 104,
            ),
          ),
          const SizedBox(height: 24),
          Text('Avatarfarbe',
              style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: _palette.map((hex) {
              final c = Color(
                  int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));
              final selected = hex == _color;
              return GestureDetector(
                onTap: () => setState(() => _color = hex),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: c,
                    shape: BoxShape.circle,
                    border: selected
                        ? Border.all(
                            color: Theme.of(context).colorScheme.onSurface,
                            width: 3)
                        : null,
                  ),
                  child: selected
                      ? const Icon(Icons.check_rounded, color: Colors.white)
                      : null,
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 28),
          TextField(
            controller: _name,
            maxLength: 40,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Anzeigename',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _about,
            maxLength: 140,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Über mich',
              hintText: 'Erzähl kurz etwas über dich …',
              prefixIcon: Icon(Icons.info_outline_rounded),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.alternate_email),
            title: Text('@${me.username}'),
            subtitle: const Text('Dein Benutzername lässt sich nicht ändern.'),
          ),
        ],
      ),
    );
  }
}
