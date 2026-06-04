import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as ws_status;

typedef SocketEvent = void Function(String type, Map<String, dynamic> payload);

/// Manages the realtime WebSocket connection: connects, parses events, and
/// transparently reconnects with backoff when the link drops.
class SocketService {
  final void Function(String type, Map<String, dynamic> payload) onEvent;
  final void Function(bool connected) onConnectionChange;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  int _attempt = 0;
  bool _wantConnected = false;
  String? _baseUrl;
  String? _token;

  SocketService({required this.onEvent, required this.onConnectionChange});

  bool get isConnected => _channel != null;

  void connect(String baseUrl, String token) {
    _baseUrl = baseUrl;
    _token = token;
    _wantConnected = true;
    _attempt = 0;
    _open();
  }

  void _open() {
    if (!_wantConnected || _baseUrl == null || _token == null) return;
    _teardownChannel();

    final root = _baseUrl!
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://')
        .replaceAll(RegExp(r'/$'), '');
    final wsUrl = '$root/ws?token=$_token';

    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    } catch (_) {
      _scheduleReconnect();
      return;
    }

    _sub = _channel!.stream.listen(
      (data) {
        _attempt = 0; // a successful frame means we're healthy again
        _handle(data);
      },
      onError: (_) => _onDrop(),
      onDone: _onDrop,
      cancelOnError: true,
    );

    // The server confirms the link with a `ready` event; mark connected
    // optimistically and let the heartbeat keep it alive.
    onConnectionChange(true);
    _startHeartbeat();
  }

  void _startHeartbeat() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      send('ping', {});
    });
  }

  void _handle(dynamic data) {
    try {
      final decoded = jsonDecode(data as String) as Map<String, dynamic>;
      final type = decoded['type'] as String;
      final payload = (decoded['payload'] as Map?)?.cast<String, dynamic>() ?? {};
      onEvent(type, payload);
    } catch (_) {
      // Ignore malformed frames rather than killing the connection.
    }
  }

  void _onDrop() {
    onConnectionChange(false);
    _teardownChannel();
    if (_wantConnected) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _attempt = (_attempt + 1).clamp(1, 6);
    // 1s, 2s, 4s … capped at 30s.
    final delay = Duration(
        seconds: (1 << (_attempt - 1)).clamp(1, 30).toInt());
    _reconnectTimer = Timer(delay, _open);
  }

  void send(String type, Map<String, dynamic> payload) {
    try {
      _channel?.sink.add(jsonEncode({'type': type, 'payload': payload}));
    } catch (_) {
      // Will be retried by the caller on next state change.
    }
  }

  /// Tell the server we've seen everything in a chat.
  void markRead(String chatId) => send('read', {'chatId': chatId});
  void markDelivered(String chatId) => send('delivered', {'chatId': chatId});
  void setTyping(String chatId, bool typing) =>
      send('typing', {'chatId': chatId, 'typing': typing});

  void _teardownChannel() {
    _pingTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    try {
      _channel?.sink.close(ws_status.normalClosure);
    } catch (_) {}
    _channel = null;
  }

  void disconnect() {
    _wantConnected = false;
    _reconnectTimer?.cancel();
    _teardownChannel();
    onConnectionChange(false);
  }
}
