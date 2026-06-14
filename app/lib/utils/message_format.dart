/// Inline, WhatsApp-style text formatting for chat messages:
///
/// * `*bold*`  → **bold**
/// * `_italic_` → _italic_
/// * `~strike~` → ~~strikethrough~~
/// * `` `code` `` → monospace (content is literal — no formatting inside)
/// * `||spoiler||` → hidden until tapped
///
/// Markers must hug their content (no leading/trailing space inside) and sit on
/// a word boundary, so everyday text like `snake_case`, `2*3=6` or a file path
/// is never accidentally formatted.
library;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// One styled slice of a message after parsing.
class FormatRun {
  final String text;
  final bool bold;
  final bool italic;
  final bool strike;
  final bool code;
  final bool spoiler;

  const FormatRun(
    this.text, {
    this.bold = false,
    this.italic = false,
    this.strike = false,
    this.code = false,
    this.spoiler = false,
  });

  bool get isPlain => !bold && !italic && !strike && !code && !spoiler;
}

class _Flags {
  final bool bold, italic, strike, code, spoiler;
  const _Flags({
    this.bold = false,
    this.italic = false,
    this.strike = false,
    this.code = false,
    this.spoiler = false,
  });

  _Flags withMarker(String marker) {
    switch (marker) {
      case '*':
        return _copy(bold: true);
      case '_':
        return _copy(italic: true);
      case '~':
        return _copy(strike: true);
      case '`':
        return _copy(code: true);
      case '||':
        return _copy(spoiler: true);
      default:
        return this;
    }
  }

  _Flags _copy({bool? bold, bool? italic, bool? strike, bool? code, bool? spoiler}) =>
      _Flags(
        bold: bold ?? this.bold,
        italic: italic ?? this.italic,
        strike: strike ?? this.strike,
        code: code ?? this.code,
        spoiler: spoiler ?? this.spoiler,
      );
}

// Longest markers first so `||` is matched before `|` (which isn't a marker).
const _markers = ['||', '*', '_', '~', '`'];

bool _isWordChar(String c) =>
    c.isNotEmpty && RegExp(r'[A-Za-z0-9]').hasMatch(c);

/// Parse [text] into a flat list of styled runs. Pure + side-effect free, so it
/// can be unit-tested directly.
List<FormatRun> parseMessageFormat(String text) {
  final out = <FormatRun>[];
  _walk(text, const _Flags(), out, 0);
  return out;
}

void _walk(String text, _Flags active, List<FormatRun> out, int depth) {
  if (depth > 8) {
    // Pathological nesting guard — emit the rest verbatim.
    _emit(text, active, out);
    return;
  }
  final buf = StringBuffer();
  var i = 0;
  while (i < text.length) {
    String? opened;
    var close = -1;
    for (final m in _markers) {
      if (_opensAt(text, i, m)) {
        final c = _findClose(text, i + m.length, m);
        if (c != -1) {
          opened = m;
          close = c;
          break;
        }
      }
    }
    if (opened == null) {
      buf.write(text[i]);
      i++;
      continue;
    }
    if (buf.isNotEmpty) {
      _emit(buf.toString(), active, out);
      buf.clear();
    }
    final inner = text.substring(i + opened.length, close);
    final next = active.withMarker(opened);
    if (opened == '`') {
      // Inline code is literal: no further parsing inside.
      _emit(inner, next, out);
    } else {
      _walk(inner, next, out, depth + 1);
    }
    i = close + opened.length;
  }
  if (buf.isNotEmpty) _emit(buf.toString(), active, out);
}

void _emit(String text, _Flags f, List<FormatRun> out) {
  if (text.isEmpty) return;
  out.add(FormatRun(
    text,
    bold: f.bold,
    italic: f.italic,
    strike: f.strike,
    code: f.code,
    spoiler: f.spoiler,
  ));
}

// An opening marker sits at a boundary (start or non-word char before it) and is
// immediately followed by non-space content (and not another copy of itself).
bool _opensAt(String text, int i, String marker) {
  if (!text.startsWith(marker, i)) return false;
  final before = i == 0 ? '' : text[i - 1];
  if (_isWordChar(before)) return false;
  final afterIndex = i + marker.length;
  if (afterIndex >= text.length) return false;
  final after = text[afterIndex];
  if (after.trim().isEmpty) return false; // no leading space inside
  if (text.startsWith(marker, afterIndex)) return false; // e.g. `**`
  return true;
}

// The matching close: same marker, preceded by non-space content, followed by a
// boundary (end or non-word char). Returns its start index, or -1.
int _findClose(String text, int from, String marker) {
  var j = from;
  while (j < text.length) {
    final at = text.indexOf(marker, j);
    if (at == -1 || at < from) return -1;
    final before = text[at - 1];
    final afterIndex = at + marker.length;
    final after = afterIndex < text.length ? text[afterIndex] : '';
    final beforeOk = before.trim().isNotEmpty; // no trailing space inside
    final afterOk = after.isEmpty || !_isWordChar(after);
    if (beforeOk && afterOk) return at;
    j = at + marker.length;
  }
  return -1;
}

/// Whether [text] contains any formatting markers worth parsing (cheap pre-check
/// so plain messages skip the parser entirely).
bool hasFormatting(String text) => RegExp(r'[*_~`]|\|\|').hasMatch(text);

/// Renders a chat message body with inline formatting. Spoilers start hidden and
/// reveal on tap. Falls back to a plain [Text] when there's nothing to format.
class FormattedMessageText extends StatefulWidget {
  final String text;
  final TextStyle style;
  final TextAlign textAlign;

  const FormattedMessageText({
    super.key,
    required this.text,
    required this.style,
    this.textAlign = TextAlign.start,
  });

  @override
  State<FormattedMessageText> createState() => _FormattedMessageTextState();
}

class _FormattedMessageTextState extends State<FormattedMessageText> {
  final Set<int> _revealed = {};
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void dispose() {
    for (final r in _recognizers) {
      r.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!hasFormatting(widget.text)) {
      return Text(widget.text, style: widget.style, textAlign: widget.textAlign);
    }
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();

    final runs = parseMessageFormat(widget.text);
    final mono = widget.style.copyWith(
      fontFamily: 'monospace',
      fontFamilyFallback: const ['monospace'],
    );
    final spoilerCover =
        (widget.style.color ?? Colors.white).withValues(alpha: 0.85);

    final spans = <InlineSpan>[];
    for (var idx = 0; idx < runs.length; idx++) {
      final run = runs[idx];
      var style = run.code ? mono : widget.style;
      style = style.copyWith(
        fontWeight: run.bold ? FontWeight.w700 : null,
        fontStyle: run.italic ? FontStyle.italic : null,
        decoration: run.strike ? TextDecoration.lineThrough : null,
      );
      if (run.spoiler && !_revealed.contains(idx)) {
        final i = idx;
        final rec = TapGestureRecognizer()
          ..onTap = () => setState(() => _revealed.add(i));
        _recognizers.add(rec);
        spans.add(TextSpan(
          text: run.text,
          style: style.copyWith(
            color: Colors.transparent,
            background: Paint()..color = spoilerCover,
          ),
          recognizer: rec,
        ));
      } else {
        spans.add(TextSpan(text: run.text, style: style));
      }
    }
    return Text.rich(TextSpan(children: spans),
        style: widget.style, textAlign: widget.textAlign);
  }
}
