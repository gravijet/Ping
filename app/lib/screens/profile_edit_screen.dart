import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/app_state.dart';
import '../theme.dart';
import '../widgets/editable_avatar.dart';
import 'security_screen.dart';

class ProfileEditScreen extends StatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  State<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends State<ProfileEditScreen> {
  late TextEditingController _name;
  late TextEditingController _about;
  late TextEditingController _pronouns;
  late TextEditingController _city;
  late TextEditingController _moodText;
  late String _color;
  String? _accent; // null/'' → use avatar colour
  String _birthday = '';
  String _moodEmoji = '';
  int _moodExpiry = 0; // index into _kMoodExpiry
  late List<ProfileLink> _links;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final me = context.read<AppState>().me!;
    _name = TextEditingController(text: me.hasName ? me.displayName : '');
    _about = TextEditingController(text: me.about);
    _pronouns = TextEditingController(text: me.pronouns);
    _city = TextEditingController(text: me.city);
    _moodText = TextEditingController(text: me.moodText);
    _color = me.avatarColor;
    _accent = me.accentColor;
    _birthday = me.birthday;
    _moodEmoji = me.moodEmoji;
    _links = List.of(me.links);
  }

  @override
  void dispose() {
    _name.dispose();
    _about.dispose();
    _pronouns.dispose();
    _city.dispose();
    _moodText.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      _snack('Dein Name darf nicht leer sein.');
      return;
    }
    setState(() => _saving = true);
    try {
      final moodText = _moodText.text.trim();
      final hasMood = moodText.isNotEmpty || _moodEmoji.isNotEmpty;
      final until = hasMood ? _kMoodExpiry[_moodExpiry].until() : null;
      await context.read<AppState>().updateProfile(
            displayName: name,
            about: _about.text.trim(),
            avatarColor: _color,
            accentColor: _accent ?? '',
            pronouns: _pronouns.text.trim(),
            city: _city.text.trim(),
            birthday: _birthday,
            links: _links,
            moodEmoji: _moodEmoji,
            moodText: moodText,
            moodUntil: until,
            clearMoodUntil: until == null,
          );
      if (mounted) {
        _snack('Profil gespeichert.');
        Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _snack(e.message);
      }
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  Color get _currentColor => _hex(_color);
  Color get _accentColor => _hex((_accent != null && _accent!.isNotEmpty) ? _accent! : _color);
  static Color _hex(String h) {
    final hex = h.replaceFirst('#', '');
    if (hex.length != 6) return const Color(0xFF5C6BC0);
    return Color(int.parse('FF$hex', radix: 16));
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AppState>().me!;
    final scheme = Theme.of(context).colorScheme;
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
        padding: EdgeInsets.zero,
        children: [
          _BannerEditor(accent: _accentColor),
          Transform.translate(
            offset: const Offset(0, -44),
            child: Center(
              child: Material(
                color: scheme.surface,
                shape: const CircleBorder(),
                elevation: 2,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: EditableAvatar(color: _currentColor, size: 104),
                ),
              ),
            ),
          ),
          Transform.translate(
            offset: const Offset(0, -28),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                children: [
                  _SectionLabel('Akzentfarbe'),
                  const SizedBox(height: 4),
                  Text(
                    'Färbt dein Profil, deinen Namen und Akzente.',
                    style: TextStyle(
                        color: scheme.onSurfaceVariant, fontSize: 12.5),
                  ),
                  const SizedBox(height: 12),
                  _ColorRow(
                    selected: _accent,
                    allowNone: true,
                    onPick: (hex) => setState(() => _accent = hex),
                  ),
                  const SizedBox(height: 24),
                  _SectionLabel('Avatarfarbe'),
                  const SizedBox(height: 12),
                  _ColorRow(
                    selected: _color,
                    allowNone: false,
                    onPick: (hex) => setState(() => _color = hex ?? _color),
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _name,
                    maxLength: 40,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Anzeigename',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                  ),
                  TextField(
                    controller: _pronouns,
                    maxLength: 40,
                    decoration: const InputDecoration(
                      labelText: 'Pronomen',
                      hintText: 'z. B. sie/ihr · er/ihm · they/them',
                      prefixIcon: Icon(Icons.tag_rounded),
                    ),
                  ),
                  TextField(
                    controller: _about,
                    maxLength: 300,
                    maxLines: 4,
                    minLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Über mich',
                      hintText: 'Erzähl etwas über dich …',
                      prefixIcon: Icon(Icons.info_outline_rounded),
                      alignLabelWithHint: true,
                    ),
                  ),
                  TextField(
                    controller: _city,
                    maxLength: 60,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Ort',
                      hintText: 'z. B. Wien',
                      prefixIcon: Icon(Icons.place_outlined),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _BirthdayTile(
                    birthday: _birthday,
                    onChanged: (v) => setState(() => _birthday = v),
                  ),
                  const SizedBox(height: 24),
                  _MoodSection(
                    emoji: _moodEmoji,
                    controller: _moodText,
                    expiryIndex: _moodExpiry,
                    onEmoji: (e) => setState(() => _moodEmoji = e),
                    onExpiry: (i) => setState(() => _moodExpiry = i),
                    onClear: () => setState(() {
                      _moodEmoji = '';
                      _moodText.clear();
                      _moodExpiry = 0;
                    }),
                  ),
                  const SizedBox(height: 24),
                  _LinksSection(
                    links: _links,
                    onChanged: (l) => setState(() => _links = l),
                  ),
                  const SizedBox(height: 16),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.phone_rounded),
                    title: Text(me.phone),
                    subtitle:
                        const Text('Deine Nummer lässt sich nicht ändern.'),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.shield_outlined, color: scheme.primary),
                    title: const Text('Sicherung & Login'),
                    subtitle: Text(
                      me.hasPassword
                          ? 'E-Mail und Passwort als Backup hinterlegt.'
                          : 'E-Mail und Passwort als Backup hinzufügen.',
                    ),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SecurityScreen()),
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: Text(text, style: Theme.of(context).textTheme.titleSmall),
      );
}

/// A horizontal palette picker. When [allowNone] a leading "Auto" swatch clears
/// the selection (passes null to [onPick]).
class _ColorRow extends StatelessWidget {
  final String? selected;
  final bool allowNone;
  final void Function(String? hex) onPick;
  const _ColorRow({
    required this.selected,
    required this.allowNone,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final none = selected == null || selected!.isEmpty;
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          if (allowNone)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: GestureDetector(
                onTap: () => onPick(null),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: none
                          ? scheme.onSurface
                          : scheme.outlineVariant,
                      width: none ? 3 : 1.5,
                    ),
                  ),
                  child: Icon(Icons.auto_awesome_rounded,
                      size: 20, color: scheme.onSurfaceVariant),
                ),
              ),
            ),
          for (final hex in kAvatarPalette)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: GestureDetector(
                onTap: () => onPick(hex),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _ProfileEditScreenState._hex(hex),
                    shape: BoxShape.circle,
                    border: selected == hex
                        ? Border.all(color: scheme.onSurface, width: 3)
                        : null,
                  ),
                  child: selected == hex
                      ? const Icon(Icons.check_rounded, color: Colors.white)
                      : null,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The profile background editor. Picks a photo / GIF or removes the banner.
class _BannerEditor extends StatefulWidget {
  final Color accent;
  const _BannerEditor({required this.accent});

  @override
  State<_BannerEditor> createState() => _BannerEditorState();
}

class _BannerEditorState extends State<_BannerEditor> {
  final _picker = ImagePicker();
  bool _busy = false;

  Future<void> _pickPhoto() async {
    setState(() => _busy = true);
    final state = context.read<AppState>();
    try {
      final file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 85,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      await state.uploadBanner(bytes, file.mimeType ?? 'image/jpeg');
    } on ApiException catch (e) {
      _err(e.message);
    } catch (_) {
      _err('Der Hintergrund konnte nicht gesetzt werden.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickGif() async {
    setState(() => _busy = true);
    final state = context.read<AppState>();
    try {
      final res = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['gif'],
        withData: true,
      );
      final f = (res == null || res.files.isEmpty) ? null : res.files.first;
      if (f == null || f.bytes == null) return;
      await state.uploadBanner(f.bytes!, 'image/gif');
    } on ApiException catch (e) {
      _err(e.message);
    } catch (_) {
      _err('Das GIF konnte nicht gesetzt werden.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    setState(() => _busy = true);
    try {
      await context.read<AppState>().removeBanner();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _err(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  void _openSheet() {
    final hasBanner = context.read<AppState>().me?.hasBanner ?? false;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Foto als Hintergrund'),
              onTap: () {
                Navigator.pop(ctx);
                _pickPhoto();
              },
            ),
            ListTile(
              leading: const Icon(Icons.gif_box_rounded),
              title: const Text('Animiertes GIF'),
              subtitle: const Text('Bewegter Hintergrund'),
              onTap: () {
                Navigator.pop(ctx);
                _pickGif();
              },
            ),
            if (hasBanner)
              ListTile(
                leading: Icon(Icons.delete_outline_rounded,
                    color: Theme.of(ctx).colorScheme.error),
                title: Text('Hintergrund entfernen',
                    style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                onTap: () {
                  Navigator.pop(ctx);
                  _remove();
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final me = state.me;
    final bannerUrl = state.bannerUrl(me);
    final gradient = DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color.lerp(widget.accent, Colors.white, 0.10)!,
            Color.lerp(widget.accent, Colors.black, 0.30)!,
          ],
        ),
      ),
    );
    return GestureDetector(
      onTap: _busy ? null : _openSheet,
      child: SizedBox(
        height: 168,
        width: double.infinity,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (bannerUrl != null)
              Image.network(
                bannerUrl,
                headers: state.authHeaders,
                fit: BoxFit.cover,
                loadingBuilder: (c, child, p) => p == null ? child : gradient,
                errorBuilder: (c, e, s) => gradient,
              )
            else
              gradient,
            Positioned(
              right: 12,
              top: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.42),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.2, color: Colors.white),
                      )
                    : const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.image_rounded,
                              size: 16, color: Colors.white),
                          SizedBox(width: 6),
                          Text('Hintergrund',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w600)),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BirthdayTile extends StatelessWidget {
  final String birthday;
  final void Function(String) onChanged;
  const _BirthdayTile({required this.birthday, required this.onChanged});

  Future<void> _pick(BuildContext context) async {
    final now = DateTime.now();
    DateTime initial = DateTime(now.year - 20, 1, 1);
    final parts = birthday.split('-');
    try {
      if (parts.length == 3) {
        initial = DateTime(
            int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
      }
    } catch (_) {/* keep default */}
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'Geburtstag wählen',
    );
    if (picked != null) {
      final mm = picked.month.toString().padLeft(2, '0');
      final dd = picked.day.toString().padLeft(2, '0');
      onChanged('${picked.year}-$mm-$dd');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.cake_outlined),
      title: const Text('Geburtstag'),
      subtitle: Text(birthday.isEmpty ? 'Nicht angegeben' : birthday),
      trailing: birthday.isEmpty
          ? const Icon(Icons.chevron_right_rounded)
          : IconButton(
              icon: Icon(Icons.clear_rounded, color: scheme.onSurfaceVariant),
              onPressed: () => onChanged(''),
            ),
      onTap: () => _pick(context),
    );
  }
}

const _kMoodEmojis = ['😀', '😎', '🎧', '💻', '📚', '🏃', '😴', '🎉', '❤️', '🌴', '☕', '🔥'];

class _MoodSection extends StatelessWidget {
  final String emoji;
  final TextEditingController controller;
  final int expiryIndex;
  final void Function(String) onEmoji;
  final void Function(int) onExpiry;
  final VoidCallback onClear;
  const _MoodSection({
    required this.emoji,
    required this.controller,
    required this.expiryIndex,
    required this.onEmoji,
    required this.onExpiry,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const _SectionLabel('Status / Stimmung'),
            const Spacer(),
            TextButton(onPressed: onClear, child: const Text('Löschen')),
          ],
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final e in _kMoodEmojis)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(e, style: const TextStyle(fontSize: 18)),
                    selected: emoji == e,
                    onSelected: (_) => onEmoji(emoji == e ? '' : e),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          maxLength: 80,
          decoration: InputDecoration(
            labelText: 'Worauf bist du gerade?',
            hintText: 'z. B. im Urlaub, lernt für Prüfungen …',
            prefixText: emoji.isEmpty ? null : '$emoji  ',
            prefixIcon: const Icon(Icons.mood_rounded),
          ),
        ),
        const SizedBox(height: 4),
        Text('Automatisch löschen nach:',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            for (var i = 0; i < _kMoodExpiry.length; i++)
              ChoiceChip(
                label: Text(_kMoodExpiry[i].label),
                selected: expiryIndex == i,
                onSelected: (_) => onExpiry(i),
              ),
          ],
        ),
      ],
    );
  }
}

class _MoodExpiry {
  final String label;
  final Duration? duration; // null = no expiry
  final bool endOfDay;
  const _MoodExpiry(this.label, this.duration, {this.endOfDay = false});

  int? until() {
    if (endOfDay) {
      final now = DateTime.now();
      return DateTime(now.year, now.month, now.day, 23, 59, 59)
          .millisecondsSinceEpoch;
    }
    if (duration == null) return null;
    return DateTime.now().add(duration!).millisecondsSinceEpoch;
  }
}

const _kMoodExpiry = [
  _MoodExpiry('Nie', null),
  _MoodExpiry('1 Std.', Duration(hours: 1)),
  _MoodExpiry('4 Std.', Duration(hours: 4)),
  _MoodExpiry('Heute', null, endOfDay: true),
  _MoodExpiry('1 Woche', Duration(days: 7)),
];

/// Editable list of profile link chips (label + url), up to six.
class _LinksSection extends StatelessWidget {
  final List<ProfileLink> links;
  final void Function(List<ProfileLink>) onChanged;
  const _LinksSection({required this.links, required this.onChanged});

  Future<void> _edit(BuildContext context, {int? index}) async {
    final existing = index != null ? links[index] : null;
    final result = await showModalBottomSheet<ProfileLink>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _LinkEditor(initial: existing),
    );
    if (result == null) return;
    final next = List.of(links);
    if (index != null) {
      next[index] = result;
    } else {
      next.add(result);
    }
    onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const _SectionLabel('Links'),
            const Spacer(),
            if (links.length < 6)
              TextButton.icon(
                onPressed: () => _edit(context),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Hinzufügen'),
              ),
          ],
        ),
        if (links.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(
              'Website, Social-Media oder andere Links – bis zu 6 Stück.',
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
            ),
          ),
        for (var i = 0; i < links.length; i++)
          Card(
            margin: const EdgeInsets.only(top: 8),
            child: ListTile(
              leading: const Icon(Icons.link_rounded),
              title: Text(links[i].display),
              subtitle: Text(links[i].url,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => _edit(context, index: i),
                  ),
                  IconButton(
                    icon: Icon(Icons.delete_outline_rounded,
                        color: scheme.error),
                    onPressed: () {
                      final next = List.of(links)..removeAt(i);
                      onChanged(next);
                    },
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _LinkEditor extends StatefulWidget {
  final ProfileLink? initial;
  const _LinkEditor({this.initial});

  @override
  State<_LinkEditor> createState() => _LinkEditorState();
}

class _LinkEditorState extends State<_LinkEditor> {
  late final TextEditingController _label =
      TextEditingController(text: widget.initial?.label ?? '');
  late final TextEditingController _url =
      TextEditingController(text: widget.initial?.url ?? '');
  String? _error;

  @override
  void dispose() {
    _label.dispose();
    _url.dispose();
    super.dispose();
  }

  void _submit() {
    var url = _url.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Bitte gib einen Link ein.');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null || uri.host.isEmpty) {
      setState(() => _error = 'Das sieht nicht nach einem gültigen Link aus.');
      return;
    }
    Navigator.pop(context, ProfileLink(label: _label.text.trim(), url: url));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(widget.initial == null ? 'Link hinzufügen' : 'Link bearbeiten',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          TextField(
            controller: _label,
            maxLength: 30,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Bezeichnung (optional)',
              hintText: 'z. B. Website, Instagram',
            ),
          ),
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: 'Link',
              hintText: 'https://…',
              errorText: _error,
            ),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submit,
              child: const Text('Speichern'),
            ),
          ),
        ],
      ),
    );
  }
}
