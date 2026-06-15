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

/// A selectable look-and-feel. Each design drives the whole UI from a seed and
/// accent: the Material colour scheme, the app-bar/brand colour, and the chat
/// bubble + wallpaper tints — so switching design changes far more than just an
/// accent colour. `id == 'custom'` carries a user-picked seed.
@immutable
class PingDesign {
  final String id;
  final String name;
  final Color seed;
  final Color accent;
  final Color tertiary;

  const PingDesign({
    required this.id,
    required this.name,
    required this.seed,
    required this.accent,
    this.tertiary = const Color(0xFF00BFA6),
  });

  PingDesign withSeed(Color seed) => PingDesign(
        id: 'custom',
        name: 'Eigene Farbe',
        seed: seed,
        accent: seed,
        tertiary: tertiary,
      );
}

/// The built-in designs. The first is the classic Ping blue.
const kPingDesigns = <PingDesign>[
  PingDesign(
      id: 'ocean',
      name: 'Ozean',
      seed: Color(0xFF0A84FF),
      accent: Color(0xFF34B7F1)),
  PingDesign(
      id: 'midnight',
      name: 'Mitternacht',
      seed: Color(0xFF5E5CE6),
      accent: Color(0xFF7E8CFF)),
  PingDesign(
      id: 'sunset',
      name: 'Sonnenuntergang',
      seed: Color(0xFFFF6F3C),
      accent: Color(0xFFFF375F)),
  PingDesign(
      id: 'forest',
      name: 'Wald',
      seed: Color(0xFF2E9E5B),
      accent: Color(0xFF66BB6A)),
  PingDesign(
      id: 'berry',
      name: 'Beere',
      seed: Color(0xFFBF5AF2),
      accent: Color(0xFFFF2D55)),
  PingDesign(
      id: 'rose',
      name: 'Rosé',
      seed: Color(0xFFEC407A),
      accent: Color(0xFFFF8FB1)),
  PingDesign(
      id: 'graphite',
      name: 'Graphit',
      seed: Color(0xFF546E7A),
      accent: Color(0xFF78909C)),
  PingDesign(
      id: 'neon',
      name: 'Neon',
      seed: Color(0xFF00BFA6),
      accent: Color(0xFF1DE9B6)),
  PingDesign(
      id: 'crimson',
      name: 'Karmin',
      seed: Color(0xFFE53935),
      accent: Color(0xFFFF6E6E)),
  PingDesign(
      id: 'amber',
      name: 'Bernstein',
      seed: Color(0xFFFFB300),
      accent: Color(0xFFFFD54F)),
  PingDesign(
      id: 'teal',
      name: 'Türkis',
      seed: Color(0xFF00ACC1),
      accent: Color(0xFF4DD0E1)),
  PingDesign(
      id: 'lavender',
      name: 'Lavendel',
      seed: Color(0xFF9575CD),
      accent: Color(0xFFB39DDB)),
  PingDesign(
      id: 'emerald',
      name: 'Smaragd',
      seed: Color(0xFF1B998B),
      accent: Color(0xFF4ECDC4)),
  PingDesign(
      id: 'slate',
      name: 'Schiefer',
      seed: Color(0xFF455A64),
      accent: Color(0xFF90A4AE)),
  PingDesign(
      id: 'cobalt',
      name: 'Kobalt',
      seed: Color(0xFF2962FF),
      accent: Color(0xFF448AFF)),
  PingDesign(
      id: 'mint',
      name: 'Minze',
      seed: Color(0xFF10B981),
      accent: Color(0xFF34D399)),
  PingDesign(
      id: 'plum',
      name: 'Pflaume',
      seed: Color(0xFF7B1FA2),
      accent: Color(0xFFBA68C8)),
  PingDesign(
      id: 'sand',
      name: 'Sand',
      seed: Color(0xFFB07A4F),
      accent: Color(0xFFD4A373)),
  PingDesign(
      id: 'flamingo',
      name: 'Flamingo',
      seed: Color(0xFFFF6F91),
      accent: Color(0xFFFF9EB5)),
];

PingDesign designById(String? id, {int? customColor}) {
  if (id == 'custom' && customColor != null) {
    return kPingDesigns.first.withSeed(Color(customColor));
  }
  return kPingDesigns.firstWhere((d) => d.id == id,
      orElse: () => kPingDesigns.first);
}

/// Ping's visual identity: a clean, WhatsApp-style messenger. A [PingDesign]
/// seed drives a harmonised Material 3 palette; the chat surfaces use a
/// [PingPalette] derived from the same seed on top.
class PingTheme {
  static const seed = Color(0xFF0A84FF); // vivid blue (classic default)
  static const accent = Color(0xFF34B7F1); // sky-blue highlight

  /// The bundled premium typeface used across the whole app — a big part of what
  /// lifts Ping out of the default-Roboto "0815" look.
  static const fontFamily = 'PlusJakartaSans';

  static ThemeData light(
    PingDesign? design, {
    bool boldText = false,
    bool highContrast = false,
  }) =>
      _build(Brightness.light, design ?? kPingDesigns.first,
          boldText: boldText, highContrast: highContrast);
  static ThemeData dark(
    PingDesign? design, {
    bool amoled = false,
    bool boldText = false,
    bool highContrast = false,
  }) =>
      _build(Brightness.dark, design ?? kPingDesigns.first,
          amoled: amoled, boldText: boldText, highContrast: highContrast);

  /// Derive the chat-surface palette (bubbles, wallpaper, app-bar) from a design
  /// seed so every design has a distinct, cohesive look.
  static PingPalette _paletteFor(PingDesign design, Brightness brightness) {
    final seed = design.seed;
    if (brightness == Brightness.light) {
      return PingPalette(
        bubbleOut: Color.alphaBlend(seed.withValues(alpha: 0.20), Colors.white),
        bubbleIn: Colors.white,
        bubbleOutText: const Color(0xFF0B1B2B),
        bubbleInText: const Color(0xFF0B1B2B),
        wallpaper:
            Color.alphaBlend(seed.withValues(alpha: 0.08), const Color(0xFFECEFF3)),
        composer:
            Color.alphaBlend(seed.withValues(alpha: 0.05), Colors.white),
        sentTick: const Color(0xFF8FA6BC),
        readTick: design.accent,
        brand: Color.alphaBlend(Colors.black.withValues(alpha: 0.12), seed),
      );
    }
    const darkBase = Color(0xFF0B141A);
    return PingPalette(
      bubbleOut: Color.alphaBlend(seed.withValues(alpha: 0.55), darkBase),
      bubbleIn: const Color(0xFF1F2C34),
      bubbleOutText: const Color(0xFFEAF2FB),
      bubbleInText: const Color(0xFFE6EBEF),
      wallpaper: Color.alphaBlend(seed.withValues(alpha: 0.12), darkBase),
      composer: Color.alphaBlend(seed.withValues(alpha: 0.10), darkBase),
      sentTick: const Color(0xFF8696A0),
      readTick: design.accent,
      brand: Color.alphaBlend(Colors.black.withValues(alpha: 0.55), seed),
    );
  }

  static ThemeData _build(
    Brightness brightness,
    PingDesign design, {
    bool amoled = false,
    bool boldText = false,
    bool highContrast = false,
  }) {
    final isLight = brightness == Brightness.light;
    final palette = _paletteFor(design, brightness);

    var scheme = ColorScheme.fromSeed(
      seedColor: design.seed,
      brightness: brightness,
      primary: isLight
          ? design.seed
          : Color.alphaBlend(Colors.white.withValues(alpha: 0.28), design.seed),
      secondary: design.accent,
      tertiary: design.tertiary,
    );

    // AMOLED dark: collapse the surface ramp toward true black so unlit OLED
    // pixels stay off. Containers keep a faint lift so cards remain legible.
    if (amoled && !isLight) {
      scheme = scheme.copyWith(
        surface: Colors.black,
        surfaceContainerLowest: Colors.black,
        surfaceContainerLow: const Color(0xFF0A0A0A),
        surfaceContainer: const Color(0xFF101012),
        surfaceContainerHigh: const Color(0xFF161618),
        surfaceContainerHighest: const Color(0xFF1C1C1F),
      );
    }

    // High contrast: darken outlines and lift on-surface text so borders,
    // dividers and secondary labels stand out — an accessibility aid.
    if (highContrast) {
      scheme = scheme.copyWith(
        outline: isLight ? const Color(0xFF3A4753) : const Color(0xFFB9C6D2),
        outlineVariant:
            isLight ? const Color(0xFF6B7884) : const Color(0xFF8A98A4),
        onSurfaceVariant:
            isLight ? const Color(0xFF2B3640) : const Color(0xFFD4DEE7),
      );
    }

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
    );

    return base.copyWith(
      extensions: [palette],
      textTheme: _textTheme(base.textTheme, scheme, boldText),
      appBarTheme: AppBarTheme(
        backgroundColor: palette.brand,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 2,
        centerTitle: false,
        titleTextStyle: const TextStyle(
          fontFamily: fontFamily,
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
        labelStyle: TextStyle(
            fontFamily: fontFamily, fontWeight: FontWeight.w700, fontSize: 14),
        unselectedLabelStyle:
            TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w600, fontSize: 14),
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
          textStyle: const TextStyle(
              fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          textStyle: const TextStyle(
              fontFamily: fontFamily, fontSize: 15, fontWeight: FontWeight.w600),
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
        color: scheme.outlineVariant.withValues(alpha: highContrast ? 0.9 : 0.4),
        space: 1,
        thickness: highContrast ? 1.2 : 1,
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

  static TextTheme _textTheme(TextTheme base, ColorScheme scheme,
      [bool bold = false]) {
    // "Bold text" nudges body and label weights up a step for legibility,
    // without touching the already-heavy display/title styles.
    final body = bold ? FontWeight.w600 : null;
    return base.copyWith(
      headlineMedium: base.headlineMedium?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.6,
      ),
      headlineSmall: base.headlineSmall?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.5,
      ),
      titleLarge: base.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
      ),
      titleMedium: base.titleMedium?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
      bodyLarge: base.bodyLarge
          ?.copyWith(height: 1.35, letterSpacing: -0.1, fontWeight: body),
      bodyMedium: base.bodyMedium
          ?.copyWith(height: 1.35, letterSpacing: -0.1, fontWeight: body),
      bodySmall: bold ? base.bodySmall?.copyWith(fontWeight: body) : base.bodySmall,
      labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w700),
    );
  }
}

/// Convenience accessor for [PingPalette] from any [BuildContext].
extension PingPaletteX on BuildContext {
  PingPalette get ping =>
      Theme.of(this).extension<PingPalette>() ?? PingPalette.light;
}
