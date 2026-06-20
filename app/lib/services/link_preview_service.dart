import 'api_client.dart';

/// The OpenGraph/HTML metadata behind a link, as returned by `GET /link-preview`
/// (0.28.0 "Kontext"). Mirrors the web client's preview card shape.
class LinkPreview {
  final String title;
  final String description;
  final String image;
  final String siteName;
  final String url;

  const LinkPreview({
    required this.title,
    required this.url,
    this.description = '',
    this.image = '',
    this.siteName = '',
  });

  factory LinkPreview.fromJson(Map<String, dynamic> json) => LinkPreview(
        title: (json['title'] ?? '') as String,
        description: (json['description'] ?? '') as String,
        image: (json['image'] ?? '') as String,
        siteName: (json['siteName'] ?? '') as String,
        url: (json['url'] ?? '') as String,
      );
}

final RegExp _urlRe = RegExp(r'(https?://[^\s<]+)', caseSensitive: false);
final RegExp _trailing = RegExp(r'''[)\]}.,;:!?'"»›]+$''');

/// The first http(s) URL in [text], with the trailing punctuation a sentence
/// tends to leave attached trimmed off. Null when there's no link.
String? firstUrl(String? text) {
  if (text == null || text.isEmpty) return null;
  final m = _urlRe.firstMatch(text);
  if (m == null) return null;
  final u = m.group(1)!.replaceAll(_trailing, '');
  return u.isEmpty ? null : u;
}

/// Fetches + memoises link previews for the session. One in-flight request per
/// URL; failures and "no preview" both resolve to null (and are cached so a dead
/// link isn't re-hit while a chat is open).
class LinkPreviewService {
  final ApiClient api;
  final Map<String, Future<LinkPreview?>> _cache = {};

  LinkPreviewService(this.api);

  Future<LinkPreview?> fetch(String url) {
    return _cache.putIfAbsent(url, () async {
      try {
        final res = await api.get('/link-preview', {'url': url});
        final p = (res as Map<String, dynamic>)['preview'];
        if (p == null) return null;
        final lp = LinkPreview.fromJson(p as Map<String, dynamic>);
        return lp.title.isEmpty ? null : lp;
      } catch (_) {
        return null;
      }
    });
  }
}
