import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

/// A chat wallpaper, encoded as a compact string so it fits in
/// shared_preferences alongside the rest of the settings.
///
/// Forms:
///   ''            → theme default
///   `color:<i>`    → one of the preset colours (index into kChatWallpapers)
///   `image:<path>` → a still image (jpg/png/webp) at an absolute file path
///   `gif:<path>`   → an animated GIF (rendered with Image.file, which animates)
///   `video:<path>` → a looping, muted video background
enum WallpaperKind { defaultBg, color, image, gif, video }

class WallpaperSpec {
  final WallpaperKind kind;
  final int colorIndex; // only for WallpaperKind.color
  final String path; // only for image/gif/video

  const WallpaperSpec._(this.kind, {this.colorIndex = 0, this.path = ''});

  static const WallpaperSpec defaultBg = WallpaperSpec._(WallpaperKind.defaultBg);

  factory WallpaperSpec.color(int index) =>
      WallpaperSpec._(WallpaperKind.color, colorIndex: index);

  bool get isMedia =>
      kind == WallpaperKind.image ||
      kind == WallpaperKind.gif ||
      kind == WallpaperKind.video;

  /// Parse a stored spec string. Unknown / empty values fall back to default.
  factory WallpaperSpec.decode(String? raw) {
    if (raw == null || raw.isEmpty || raw == 'default') {
      return defaultBg;
    }
    final i = raw.indexOf(':');
    if (i == -1) return defaultBg;
    final head = raw.substring(0, i);
    final rest = raw.substring(i + 1);
    switch (head) {
      case 'color':
        return WallpaperSpec.color(int.tryParse(rest) ?? 0);
      case 'image':
        return WallpaperSpec._(WallpaperKind.image, path: rest);
      case 'gif':
        return WallpaperSpec._(WallpaperKind.gif, path: rest);
      case 'video':
        return WallpaperSpec._(WallpaperKind.video, path: rest);
      default:
        return defaultBg;
    }
  }

  String encode() {
    switch (kind) {
      case WallpaperKind.defaultBg:
        return '';
      case WallpaperKind.color:
        return 'color:$colorIndex';
      case WallpaperKind.image:
        return 'image:$path';
      case WallpaperKind.gif:
        return 'gif:$path';
      case WallpaperKind.video:
        return 'video:$path';
    }
  }
}

/// Picks wallpaper media and copies it into the app's private documents
/// directory so it survives even if the original is moved/deleted.
class WallpaperService {
  Future<Directory> _dir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/wallpapers');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<String> _copyInto(String sourcePath, String suffix) async {
    final dir = await _dir();
    final ext = sourcePath.contains('.')
        ? sourcePath.substring(sourcePath.lastIndexOf('.'))
        : suffix;
    final dest = '${dir.path}/wp_${DateTime.now().millisecondsSinceEpoch}$ext';
    await File(sourcePath).copy(dest);
    return dest;
  }

  /// Pick a still image from the gallery and store it. Returns the spec or null
  /// if the user cancelled.
  Future<WallpaperSpec?> pickImage() async {
    final file = await ImagePicker()
        .pickImage(source: ImageSource.gallery, maxWidth: 2000, imageQuality: 90);
    if (file == null) return null;
    final stored = await _copyInto(file.path, '.jpg');
    return WallpaperSpec.decode('image:$stored');
  }

  /// Pick an animated GIF and store it.
  Future<WallpaperSpec?> pickGif() async {
    final res = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['gif'],
    );
    if (res == null || res.files.isEmpty || res.files.first.path == null) {
      return null;
    }
    final stored = await _copyInto(res.files.first.path!, '.gif');
    return WallpaperSpec.decode('gif:$stored');
  }

  /// Pick a video and store it (used as a looping, muted background).
  Future<WallpaperSpec?> pickVideo() async {
    final file = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (file == null) return null;
    final stored = await _copyInto(file.path, '.mp4');
    return WallpaperSpec.decode('video:$stored');
  }

  /// Remove a stored wallpaper file (best-effort) when it's replaced/cleared.
  Future<void> deleteFile(String path) async {
    if (path.isEmpty) return;
    try {
      final f = File(path);
      if (await f.exists()) await f.delete();
    } catch (_) {
      /* best effort */
    }
  }
}
