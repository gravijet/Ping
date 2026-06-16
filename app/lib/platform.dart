import 'package:flutter/foundation.dart';

/// Tiny platform helpers so feature gating reads the same everywhere. Several
/// plugins (FCM push, contacts, the APK self-updater, inline video) only exist
/// on Android; on the Windows desktop build we light up a chat-focused subset.
///
/// These are deliberately based on [defaultTargetPlatform] (which is safe to
/// touch on web) rather than `dart:io`'s `Platform`, so the same code compiles
/// for every target.

bool get isMobilePlatform =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS);

bool get isDesktopPlatform =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.linux ||
        defaultTargetPlatform == TargetPlatform.macOS);

/// True on the Android build, where FCM push, phone-number verification and the
/// in-app APK updater are available.
bool get isAndroidPlatform =>
    !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

/// True in the browser (Flutter web build). The web app is a "second screen"
/// that links to a phone like WhatsApp Web — same chat-focused subset as the
/// desktop build, but served from the browser.
bool get isWebPlatform => kIsWeb;

/// Builds that sign in by linking to a phone via a scanned QR code (they have
/// no phone number of their own): the Windows desktop app and the browser web
/// app. Both render the QR; the phone scans and approves it.
bool get usesQrLinkLogin => isDesktopPlatform || kIsWeb;

/// The "lite", chat-focused client (desktop + web): features that only exist on
/// the Android build — inline video playback, the camera, contacts, push and
/// calls — are off here. Lets a single check stand in for "not the full mobile
/// app" wherever that distinction matters.
bool get isLiteClient => isDesktopPlatform || kIsWeb;
