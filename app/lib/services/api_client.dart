import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thrown for any non-2xx response or transport failure. [message] is always
/// safe to show to the user — the server sends human German error strings.
class ApiException implements Exception {
  final String message;
  final int? status;
  ApiException(this.message, [this.status]);
  @override
  String toString() => message;
}

/// Thin REST wrapper around the Ping backend. Holds the base URL and the auth
/// token; every call returns decoded JSON or throws an [ApiException].
class ApiClient {
  String baseUrl;
  String? token;
  final http.Client _http;

  ApiClient({required this.baseUrl, this.token, http.Client? client})
      : _http = client ?? http.Client();

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return Uri.parse('$root/api${_route(path)}').replace(
      queryParameters: query?.map((k, v) => MapEntry(k, v.toString())),
    );
  }

  /// Admin endpoints are reached through the Cloudflare-Access-free `/console`
  /// bridge. The native client can't carry the browser's Cloudflare Access
  /// login, so the server exposes the very same `/admin/*` handlers under
  /// `/api/console/*` (gated by the user's admin JWT instead). Call sites still
  /// use the readable `/admin/...` paths; this maps them transparently.
  static String _route(String path) =>
      (path == '/admin' || path.startsWith('/admin/'))
          ? '/console${path.substring('/admin'.length)}'
          : path;

  Future<dynamic> get(String path, [Map<String, dynamic>? query]) =>
      _send(() => _http.get(_uri(path, query), headers: _headers));

  Future<dynamic> post(String path, [Object? body]) => _send(() => _http.post(
        _uri(path),
        headers: _headers,
        body: jsonEncode(body ?? {}),
      ));

  /// Upload raw bytes (e.g. an image, a voice note or a file) with an explicit
  /// content type. An optional [filename] is sent in X-Filename so the server
  /// can preserve the original name.
  Future<dynamic> postBytes(String path, List<int> bytes, String contentType,
          {String? filename}) =>
      _send(() => _http.post(
            _uri(path),
            headers: {
              'Content-Type': contentType,
              if (token != null) 'Authorization': 'Bearer $token',
              if (filename != null && filename.isNotEmpty)
                'X-Filename': Uri.encodeComponent(filename),
            },
            body: bytes,
          ));

  Future<dynamic> put(String path, [Object? body]) =>
      _send(() => _http.put(
            _uri(path),
            headers: _headers,
            body: jsonEncode(body ?? {}),
          ));

  Future<dynamic> patch(String path, [Object? body]) =>
      _send(() => _http.patch(
            _uri(path),
            headers: _headers,
            body: jsonEncode(body ?? {}),
          ));

  Future<dynamic> delete(String path, [Object? body]) =>
      _send(() => _http.delete(
            _uri(path),
            headers: _headers,
            body: body != null ? jsonEncode(body) : null,
          ));

  Future<dynamic> _send(Future<http.Response> Function() request) async {
    http.Response res;
    try {
      res = await request().timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw ApiException(
          'Der Server antwortet nicht. Prüf deine Verbindung und die Server-Adresse.');
    } catch (_) {
      throw ApiException(
          'Keine Verbindung zum Server. Läuft er und stimmt die Adresse in den Einstellungen?');
    }

    final isJson =
        (res.headers['content-type'] ?? '').contains('application/json');
    final data = isJson && res.body.isNotEmpty ? jsonDecode(res.body) : null;

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return data;
    }
    final msg = data is Map && data['error'] is String
        ? data['error'] as String
        : 'Unerwarteter Fehler (${res.statusCode}).';
    throw ApiException(msg, res.statusCode);
  }

  /// Hit the server's `/health` endpoint (which sits outside `/api`). Returns
  /// the decoded JSON, or null on any failure. Used by the debug chat.
  Future<Map<String, dynamic>?> health() async {
    final root = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    try {
      final res = await _http
          .get(Uri.parse('$root/health'))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
    } catch (_) {
      /* unreachable */
    }
    return null;
  }

  void close() => _http.close();
}
