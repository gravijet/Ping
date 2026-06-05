import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The avatar colour palette, mirroring the server's. Used wherever a user can
/// pick a fallback colour for their avatar.
const kAvatarPalette = [
  '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
  '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
  '#9CCC65', '#FFA726', '#FF7043', '#8D6E63', '#78909C',
];

/// WhatsApp-inspired colours that live outside the Material [ColorScheme]:
/// chat bubbles, the conversation wallpaper and the read-receipt tick colour.
/// Exposed as a [ThemeExtension] so widgets read them via the [Theme].
@immutable
class PingPalette extends ThemeExtension<PingPalette> {
  final Color bubbleOut; // my messages
  final Color bubbleIn; // their messages
  final Color bubbleOutText;
  final Color bubbleInText;
  final Color wallpaper; // chat background
  final Color composer; // input bar background
  final Color sentTick; // grey ticks
  final Color readTick; // blue ticks once read
  final Color brand; // app-bar / header colour

  const PingPalette({
    required this.bubbleOut,
    required this.bubbleIn,
    required this.bubbleOutText,
    required this.bubbleInText,
    required this.wallpaper,
    required this.composer,
    required this.sentTick,
    required this.readTick,
    required this.brand,
  });

  static const light = PingPalette(
    bubbleOut: Color(0xFFD6ECFF),
    bubbleIn: Color(0xFFFFFFFF),
    bubbleOutText: Color(0xFF0B1B2B),
    bubbleInText: Color(0xFF0B1B2B),
    wallpaper: Color(0xFFE9EFF5),
    composer: Color(0xFFF4F7FA),
    sentTick: Color(0xFF8FA6BC),
    readTick: Color(0xFF34B7F1),
    brand: Color(0xFF0B7BE8),
  );

  static const dark = PingPalette(
    bubbleOut: Color(0xFF14497A),
    bubbleIn: Color(0xFF1F2C34),
    bubbleOutText: Color(0xFFEAF2FB),
    bubbleInText: Color(0xFFE6EBEF),
    wallpaper: Color(0xFF0B141A),
    composer: Color(0xFF111B22),
    sentTick: Color(0xFF8696A0),
    readTick: Color(0xFF53BDEB),
    brand: Color(0xFF11202B),
  );

  @override
  PingPalette copyWith({
    Color? bubbleOut,
    Color? bubbleIn,
    Color? bubbleOutText,
    Color? bubbleInText,
    Color? wallpaper,
    Color? composer,
    Color? sentTick,
    Color? readTick,
    Color? brand,
  }) =>
      PingPalette(
        bubbleOut: bubbleOut ?? this.bubbleOut,
        bubbleIn: bubbleIn ?? this.bubbleIn,
        bubbleOutText: bubbleOutText ?? this.bubbleOutText,
        bubbleInText: bubbleInText ?? this.bubbleInText,
        wallpaper: wallpaper ?? this.wallpaper,
        composer: composer ?? this.composer,
        sentTick: sentTick ?? this.sentTick,
        readTick: readTick ?? this.readTick,
        brand: brand ?? this.brand,
      );

  @override
  PingPalette lerp(ThemeExtension<PingPalette>? other, double t) {
    if (other is! PingPalette) return this;
    return PingPalette(
      bubbleOut: Color.lerp(bubbleOut, other.bubbleOut, t)!,
      bubbleIn: Color.lerp(bubbleIn, other.bubbleIn, t)!,
      bubbleOutText: Color.lerp(bubbleOutText, other.bubbleOutText, t)!,
      bubbleInText: Color.lerp(bubbleInText, other.bubbleInText, t)!,
      wallpaper: Color.lerp(wallpaper, other.wallpaper, t)!,
      composer: Color.lerp(composer, other.composer, t)!,
      sentTick: Color.lerp(sentTick, other.sentTick, t)!,
      readTick: Color.lerp(readTick, other.readTick, t)!,
      brand: Color.lerp(brand, other.brand, t)!,
    );
  }
}

/// Ping's visual identity: a clean, WhatsApp-style messenger built around a
/// confident blue. One seed drives a harmonised Material 3 palette; the chat
/// surfaces use [PingPalette] on top.
class PingTheme {
  static const seed = Color(0xFF0A84FF); // vivid blue
  static const accent = Color(0xFF34B7F1); // sky-blue highlight

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isLight = brightness == Brightness.light;
    final palette = isLight ? PingPalette.light : PingPalette.dark;

    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: brightness,
      primary: isLight ? const Color(0xFF0A84FF) : const Color(0xFF53A6FF),
      secondary: const Color(0xFF34B7F1),
      tertiary: const Color(0xFF00BFA6),
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
    );

    return base.copyWith(
      extensions: [palette],
      textTheme: _textTheme(base.textTheme, scheme),
      appBarTheme: AppBarTheme(
        backgroundColor: palette.brand,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 2,
        centerTitle: false,
        titleTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 20,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: Colors.white,
        unselectedLabelColor: Color(0xCCFFFFFF),
        indicatorColor: Colors.white,
        indicatorSize: TabBarIndicatorSize.tab,
        labelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        dividerColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        clipBehavior: Clip.antiAlias,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: scheme.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        insetPadding: const EdgeInsets.all(16),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant.withValues(alpha: 0.4),
        space: 1,
        thickness: 1,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        elevation: 3,
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),
    );
  }

  static TextTheme _textTheme(TextTheme base, ColorScheme scheme) {
    return base.copyWith(
      headlineSmall: base.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
      ),
      titleLarge: base.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
      titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      bodyMedium: base.bodyMedium?.copyWith(height: 1.35),
      labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w600),
    );
  }
}

/// Convenience accessor for [PingPalette] from any [BuildContext].
extension PingPaletteX on BuildContext {
  PingPalette get ping =>
      Theme.of(this).extension<PingPalette>() ?? PingPalette.light;
}
