/// In-app updater. On Android this checks the server for a newer APK and can
/// download + launch the package installer; on web/desktop it's a no-op stub
/// (those builds update by reloading / re-downloading, not by installing an
/// APK). [UpdateInfo] and the helpers are always available.
library;

export 'update_info.dart';
export 'update_service_web.dart'
    if (dart.library.io) 'update_service_io.dart';
