/// Platform file helpers that need `dart:io` on native targets. On the web build
/// there is no real filesystem, so bytes that need to be "played" or "opened"
/// become blob: object URLs and "save to device" triggers a normal browser
/// download. Centralised here so the rest of the app stays free of `dart:io`
/// imports and compiles for web.
///
/// On native, the "path" values returned/accepted are real file paths; on web
/// they are blob: URLs (which Image.network, VideoPlayerController.networkUrl,
/// audioplayers' UrlSource and package:http can all consume).
library;

export 'platform_files_web.dart'
    if (dart.library.io) 'platform_files_io.dart';
