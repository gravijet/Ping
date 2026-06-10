import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/app_state.dart';
import 'avatar.dart';

/// The signed-in user's avatar with a camera badge; tap to pick, take or remove
/// a profile picture. Used on the profile-setup and profile-edit screens.
class EditableAvatar extends StatefulWidget {
  final double size;
  final Color color;
  const EditableAvatar({super.key, this.size = 112, required this.color});

  @override
  State<EditableAvatar> createState() => _EditableAvatarState();
}

class _EditableAvatarState extends State<EditableAvatar> {
  final _picker = ImagePicker();
  bool _busy = false;

  Future<void> _pick(ImageSource source) async {
    setState(() => _busy = true);
    final state = context.read<AppState>();
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (file == null) {
        if (mounted) setState(() => _busy = false);
        return;
      }
      final bytes = await file.readAsBytes();
      await state.uploadAvatar(bytes, file.mimeType ?? 'image/jpeg');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profilbild aktualisiert.')),
        );
      }
    } on ApiException catch (e) {
      _error(e.message);
    } catch (_) {
      _error('Das Bild konnte nicht ausgewählt werden.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Pick an animated GIF as the avatar. Uses the file picker (not image_picker)
  /// so the animation is preserved instead of being re-encoded to a still JPEG.
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
      if (f == null || f.bytes == null) {
        if (mounted) setState(() => _busy = false);
        return;
      }
      await state.uploadAvatar(f.bytes!, 'image/gif');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Animiertes Profilbild aktualisiert.')),
        );
      }
    } on ApiException catch (e) {
      _error(e.message);
    } catch (_) {
      _error('Das GIF konnte nicht ausgewählt werden.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    setState(() => _busy = true);
    try {
      await context.read<AppState>().removeAvatar();
    } on ApiException catch (e) {
      _error(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _error(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  void _openSheet() {
    final hasAvatar = context.read<AppState>().me?.hasAvatar ?? false;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Aus Galerie wählen'),
              onTap: () {
                Navigator.pop(ctx);
                _pick(ImageSource.gallery);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Foto aufnehmen'),
              onTap: () {
                Navigator.pop(ctx);
                _pick(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.gif_box_rounded),
              title: const Text('Animiertes GIF'),
              subtitle: const Text('Bewegtes Profilbild'),
              onTap: () {
                Navigator.pop(ctx);
                _pickGif();
              },
            ),
            if (hasAvatar)
              ListTile(
                leading: Icon(Icons.delete_outline_rounded,
                    color: Theme.of(ctx).colorScheme.error),
                title: Text('Bild entfernen',
                    style:
                        TextStyle(color: Theme.of(ctx).colorScheme.error)),
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
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: _busy ? null : _openSheet,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          PingAvatar(
            initials: me?.initials ?? '',
            color: widget.color,
            size: widget.size,
            imageUrl: state.avatarUrl(me),
            imageHeaders: state.authHeaders,
          ),
          if (_busy)
            Positioned.fill(
              child: Container(
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black38,
                ),
                child: const Center(
                  child: SizedBox(
                    width: 26,
                    height: 26,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.6, color: Colors.white),
                  ),
                ),
              ),
            ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: scheme.primary,
                shape: BoxShape.circle,
                border: Border.all(color: scheme.surface, width: 2.5),
              ),
              child: Icon(Icons.photo_camera_rounded,
                  size: 18, color: scheme.onPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
