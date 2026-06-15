/// Detect "emoji-only" messages so they can be rendered jumbo-sized, the way
/// WhatsApp/iMessage do. Deliberately conservative: ranges are chosen so normal
/// text can never be mistaken for emoji (the worst case is a rare emoji simply
/// rendering at the normal size — never enlarging real words).
class EmojiText {
  EmojiText._();

  /// Base pictographic code points (the bulk of all emoji live in the
  /// supplementary planes; the two BMP blocks cover ☀ ✅ ⭐ and friends).
  static bool _isBaseEmoji(int r) =>
      (r >= 0x1F000 && r <= 0x1FAFF) || // emoji & pictographic supplement
      (r >= 0x2600 && r <= 0x27BF) || // misc symbols + dingbats
      (r >= 0x2B00 && r <= 0x2BFF); // stars / arrows used as emoji

  /// Zero-width joiner, variation selectors and the keycap combiner — glue that
  /// holds composite emoji together but isn't itself "a character".
  static const _glue = {0x200D, 0xFE0F, 0xFE0E, 0x20E3};

  static bool _isSpace(int r) =>
      r == 0x20 || r == 0x09 || r == 0x0A || r == 0x0D;

  /// Whether [text] consists solely of emoji (plus optional whitespace/glue).
  static bool isEmojiOnly(String text) {
    var sawEmoji = false;
    for (final r in text.runes) {
      if (_isBaseEmoji(r)) {
        sawEmoji = true;
      } else if (_glue.contains(r) || _isSpace(r)) {
        continue;
      } else {
        return false;
      }
    }
    return sawEmoji;
  }

  /// Rough count of emoji glyphs (over-counts ZWJ sequences, which is fine — it
  /// only buckets the display size).
  static int count(String text) {
    var n = 0;
    for (final r in text.runes) {
      if (_isBaseEmoji(r)) n++;
    }
    return n;
  }

  /// Font-size multiplier for an emoji-only message, scaled down as the emoji
  /// count grows. Returns 1.0 (no enlargement) for long emoji runs or non-emoji
  /// text, so callers can use it unconditionally.
  static double scaleFor(String text) {
    if (!isEmojiOnly(text)) return 1.0;
    final n = count(text);
    if (n <= 0) return 1.0;
    if (n == 1) return 3.2;
    if (n == 2) return 2.6;
    if (n == 3) return 2.2;
    if (n <= 6) return 1.8;
    return 1.0;
  }
}
