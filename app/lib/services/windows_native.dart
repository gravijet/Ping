import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:launch_at_startup/launch_at_startup.dart';
import 'package:local_notifier/local_notifier.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/window_manager.dart';

/// Native desktop integration for the Windows shell. The web client
/// (server/public/webclient) talks to this over the WebView2 message channel:
/// it posts JSON (`unread`, `notify`, `autostart`, `open-url`, …) and we drive
/// the tray, OS notifications, the **taskbar overlay badge + flash** (via a tiny
/// `ping/native` method channel in the C++ runner), auto-start, minimise-to-tray
/// and window-state memory. Everything is best-effort and guarded — a missing
/// capability never takes down the shell.
///
/// Messages back to the web app (chat to open, focus, run a command, …) go
/// through [postToWeb], wired to `WebviewController.postWebMessage`.
typedef PostToWeb = void Function(Map<String, dynamic> message);

class WindowsNative with TrayListener, WindowListener {
  WindowsNative(this.postToWeb);

  final PostToWeb postToWeb;

  /// When true, closing/minimising the window hides it to the tray.
  bool closeToTray = true;
  bool _quitting = false;
  Timer? _saveBoundsDebounce;

  static const _trayIcon = 'windows/runner/resources/app_icon.ico';
  static const _channel = MethodChannel('ping/native');
  static const _boundsKey = 'ping.win.bounds';

  Future<void> init() async {
    if (!_isWindows) return;
    try {
      await windowManager.ensureInitialized();
      windowManager.addListener(this);
      await windowManager.setPreventClose(true);
      await _restoreBounds();
    } catch (e) {
      debugPrint('WindowsNative window init failed: $e');
    }
    try {
      trayManager.addListener(this);
      await trayManager.setIcon(_trayIcon);
      await trayManager.setToolTip('Ping');
      await _rebuildTrayMenu();
    } catch (e) {
      debugPrint('WindowsNative tray init failed: $e');
    }
    try {
      await localNotifier.setup(appName: 'Ping');
    } catch (e) {
      debugPrint('WindowsNative notifier init failed: $e');
    }
    try {
      launchAtStartup.setup(appName: 'Ping', appPath: Platform.resolvedExecutable);
    } catch (e) {
      debugPrint('WindowsNative autostart init failed: $e');
    }
  }

  bool get _isWindows => !kIsWeb && Platform.isWindows;

  // ---- messages from the web app ------------------------------------------
  void handleWebMessage(dynamic raw) {
    Map<String, dynamic> data;
    try {
      data = raw is String
          ? jsonDecode(raw) as Map<String, dynamic>
          : Map<String, dynamic>.from(raw as Map);
    } catch (_) {
      return;
    }
    switch (data['type']) {
      case 'unread':
        _setUnread((data['count'] as num?)?.toInt() ?? 0);
        break;
      case 'notify':
        _notify(data);
        break;
      case 'autostart':
        setAutostart(data['on'] == true);
        break;
      case 'closeToTray':
        closeToTray = data['on'] == true;
        _rebuildTrayMenu();
        break;
      case 'open-url':
        _openExternal((data['url'] ?? '').toString());
        break;
      case 'ready':
        postToWeb({'type': 'shell', 'platform': 'windows'});
        break;
    }
  }

  Future<void> _setUnread(int count) async {
    // Reflect the count in three places: the real taskbar overlay badge (native
    // channel), the window title and the tray tooltip.
    try {
      await _channel.invokeMethod('overlayBadge', {'count': count});
    } catch (_) {}
    try {
      await windowManager.setTitle(count > 0 ? 'Ping ($count)' : 'Ping');
    } catch (_) {}
    try {
      await trayManager.setToolTip(count > 0 ? 'Ping — $count ungelesen' : 'Ping');
    } catch (_) {}
  }

  Future<void> _notify(Map<String, dynamic> data) async {
    try {
      final n = LocalNotification(
        title: (data['title'] ?? 'Ping').toString(),
        body: (data['body'] ?? '').toString(),
      );
      n.onClick = () {
        _restore();
        postToWeb({'type': 'open-chat', 'chatId': (data['chatId'] ?? '').toString()});
      };
      await n.show();
    } catch (e) {
      debugPrint('WindowsNative notify failed: $e');
    }
    // Bounce the taskbar if Ping isn't the foreground window.
    try {
      await _channel.invokeMethod('flash');
    } catch (_) {}
  }

  Future<void> _openExternal(String url) async {
    if (url.isEmpty) return;
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('WindowsNative openExternal failed: $e');
    }
  }

  Future<void> setAutostart(bool on) async {
    try {
      if (on) {
        await launchAtStartup.enable();
      } else {
        await launchAtStartup.disable();
      }
    } catch (e) {
      debugPrint('WindowsNative setAutostart failed: $e');
    }
  }

  Future<void> _restore() async {
    try {
      await windowManager.show();
      await windowManager.focus();
    } catch (_) {}
  }

  // ---- window-state memory -------------------------------------------------
  Future<void> _restoreBounds() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_boundsKey);
      if (raw == null) return;
      final b = jsonDecode(raw) as Map<String, dynamic>;
      await windowManager.setBounds(Rect.fromLTWH(
        (b['x'] as num).toDouble(), (b['y'] as num).toDouble(),
        (b['w'] as num).toDouble(), (b['h'] as num).toDouble(),
      ));
    } catch (e) {
      debugPrint('WindowsNative restoreBounds failed: $e');
    }
  }

  void _saveBoundsSoon() {
    _saveBoundsDebounce?.cancel();
    _saveBoundsDebounce = Timer(const Duration(milliseconds: 600), () async {
      try {
        if (await windowManager.isMinimized() || await windowManager.isMaximized()) return;
        final r = await windowManager.getBounds();
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_boundsKey,
            jsonEncode({'x': r.left, 'y': r.top, 'w': r.width, 'h': r.height}));
      } catch (_) {}
    });
  }

  Future<void> _rebuildTrayMenu() async {
    try {
      await trayManager.setContextMenu(Menu(items: [
        MenuItem(key: 'show', label: 'Ping öffnen'),
        MenuItem(key: 'newchat', label: 'Neuer Chat'),
        MenuItem(key: 'settings', label: 'Einstellungen'),
        MenuItem.checkbox(
          key: 'tray',
          label: 'Beim Schließen in den Infobereich',
          checked: closeToTray,
        ),
        MenuItem.separator(),
        MenuItem(key: 'quit', label: 'Beenden'),
      ]));
    } catch (_) {}
  }

  // ---- tray events ---------------------------------------------------------
  @override
  void onTrayIconMouseDown() => _restore();

  @override
  void onTrayIconRightMouseDown() => trayManager.popUpContextMenu();

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    switch (menuItem.key) {
      case 'show':
        _restore();
        break;
      case 'newchat':
        _restore();
        postToWeb({'type': 'new-chat'});
        break;
      case 'settings':
        _restore();
        postToWeb({'type': 'settings'});
        break;
      case 'tray':
        closeToTray = !closeToTray;
        _rebuildTrayMenu();
        break;
      case 'quit':
        _quit();
        break;
    }
  }

  // ---- window events -------------------------------------------------------
  @override
  void onWindowClose() {
    if (closeToTray && !_quitting) {
      windowManager.hide();
    } else {
      windowManager.destroy();
    }
  }

  @override
  void onWindowMinimize() {
    if (closeToTray) windowManager.hide();
  }

  @override
  void onWindowMoved() => _saveBoundsSoon();

  @override
  void onWindowResized() => _saveBoundsSoon();

  Future<void> _quit() async {
    _quitting = true;
    try {
      await windowManager.setPreventClose(false);
    } catch (_) {}
    await windowManager.destroy();
  }

  void dispose() {
    _saveBoundsDebounce?.cancel();
    try {
      trayManager.removeListener(this);
      windowManager.removeListener(this);
      trayManager.destroy();
    } catch (_) {}
  }
}
