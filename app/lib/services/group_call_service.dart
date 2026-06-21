import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

/// One remote participant in a group (mesh) call: a peer connection, the remote
/// renderer it feeds, and a display label.
class GroupParticipant {
  final String userId;
  String name;
  final RTCPeerConnection pc;
  final RTCVideoRenderer renderer;
  bool connected = false;
  GroupParticipant(
      {required this.userId,
      required this.name,
      required this.pc,
      required this.renderer});
}

/// Drives a small **full-mesh** WebRTC group call (0.34.0): every participant
/// holds one [RTCPeerConnection] per other participant. Signaling rides the same
/// socket as 1:1 calls but through the server's `group-call-*` relay (see
/// `hub.js`): join/leave announce a roster, and offer/answer/ice are addressed to
/// a specific peer (`to`). To avoid offer "glare" the peer with the
/// lexicographically smaller id always makes the offer for a pair.
///
/// Mesh scales to a handful of participants (~4–6); an SFU would be follow-up
/// work. Gated behind the `groupCalls` remote flag — validate on real devices
/// before enabling.
class GroupCallController extends ChangeNotifier {
  GroupCallController({
    required this.sendSignal,
    required this.fetchIce,
    required this.selfId,
  });

  final void Function(String type, Map<String, dynamic> payload) sendSignal;
  final Future<List<Map<String, dynamic>>> Function() fetchIce;
  final String selfId;

  static const _native = MethodChannel('ping/native');

  final RTCVideoRenderer localRenderer = RTCVideoRenderer();
  final Map<String, GroupParticipant> participants = {};

  MediaStream? _localStream;
  String? chatId;
  String? callId;
  bool video = false;
  bool micOn = true;
  bool camOn = true;
  bool _active = false;
  bool get isActive => _active;

  /// Names for participant ids, supplied by the caller (chat member list).
  Map<String, String> nameLookup = const {};

  Future<List<Map<String, dynamic>>> _ice() async {
    try {
      final servers = await fetchIce();
      if (servers.isNotEmpty) return servers;
    } catch (_) {/* public STUN fallback */}
    return [
      {'urls': 'stun:stun.l.google.com:19302'},
    ];
  }

  /// Join (or open) the call for [chatId] / [callId].
  Future<void> join(String chatId, String callId,
      {required bool video, Map<String, String> names = const {}}) async {
    if (_active) return;
    this.chatId = chatId;
    this.callId = callId;
    this.video = video;
    nameLookup = names;
    camOn = video;
    await localRenderer.initialize();
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': video ? {'facingMode': 'user'} : false,
    });
    localRenderer.srcObject = _localStream;
    _active = true;
    _setNativeCallActive(true);
    sendSignal('group-call-join', {
      'chatId': chatId,
      'callId': callId,
      'video': video,
    });
    notifyListeners();
  }

  /// The server pushed a fresh roster — open a connection to any new peer (and
  /// drop any who left). The smaller-id side initiates the offer.
  Future<void> onRoster(List<String> ids) async {
    if (!_active) return;
    final others = ids.where((id) => id != selfId).toSet();
    // New peers.
    for (final id in others) {
      if (!participants.containsKey(id)) {
        final p = await _createPeer(id);
        if (selfId.compareTo(id) < 0) {
          final offer = await p.pc.createOffer({
            'offerToReceiveAudio': true,
            'offerToReceiveVideo': video,
          });
          await p.pc.setLocalDescription(offer);
          sendSignal('group-call-offer', {
            'chatId': chatId,
            'callId': callId,
            'to': id,
            'sdp': offer.sdp,
            'sdpType': offer.type,
          });
        }
      }
    }
    // Departed peers.
    for (final id in participants.keys.toList()) {
      if (!others.contains(id)) _dropPeer(id);
    }
    notifyListeners();
  }

  Future<GroupParticipant> _createPeer(String peerId) async {
    final pc = await createPeerConnection({
      'iceServers': await _ice(),
      'sdpSemantics': 'unified-plan',
    });
    final renderer = RTCVideoRenderer();
    await renderer.initialize();
    final participant = GroupParticipant(
      userId: peerId,
      name: nameLookup[peerId] ?? 'Teilnehmer',
      pc: pc,
      renderer: renderer,
    );
    participants[peerId] = participant;

    pc.onIceCandidate = (c) {
      if (c.candidate == null) return;
      sendSignal('group-call-ice', {
        'chatId': chatId,
        'callId': callId,
        'to': peerId,
        'candidate': c.toMap(),
      });
    };
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        renderer.srcObject = event.streams.first;
        notifyListeners();
      }
    };
    pc.onConnectionState = (s) {
      participant.connected =
          s == RTCPeerConnectionState.RTCPeerConnectionStateConnected;
      if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
        _dropPeer(peerId);
      }
      notifyListeners();
    };

    final stream = _localStream;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }
    }
    return participant;
  }

  Future<void> onOffer(
      String fromId, String? sdp, String? sdpType) async {
    if (!_active || sdp == null) return;
    var p = participants[fromId];
    p ??= await _createPeer(fromId);
    await p.pc.setRemoteDescription(
        RTCSessionDescription(sdp, sdpType ?? 'offer'));
    final answer = await p.pc.createAnswer();
    await p.pc.setLocalDescription(answer);
    sendSignal('group-call-answer', {
      'chatId': chatId,
      'callId': callId,
      'to': fromId,
      'sdp': answer.sdp,
      'sdpType': answer.type,
    });
  }

  Future<void> onAnswer(
      String fromId, String? sdp, String? sdpType) async {
    final p = participants[fromId];
    if (p == null || sdp == null) return;
    await p.pc.setRemoteDescription(
        RTCSessionDescription(sdp, sdpType ?? 'answer'));
  }

  Future<void> onIce(String fromId, Map<String, dynamic>? cand) async {
    final p = participants[fromId];
    if (p == null || cand == null) return;
    await p.pc.addCandidate(RTCIceCandidate(
      cand['candidate'] as String?,
      cand['sdpMid'] as String?,
      (cand['sdpMLineIndex'] as num?)?.toInt(),
    ));
  }

  void _dropPeer(String id) {
    final p = participants.remove(id);
    if (p == null) return;
    p.pc.close();
    p.renderer.srcObject = null;
    p.renderer.dispose();
    notifyListeners();
  }

  void toggleMic() {
    micOn = !micOn;
    for (final t in _localStream?.getAudioTracks() ?? const []) {
      t.enabled = micOn;
    }
    notifyListeners();
  }

  void toggleCam() {
    camOn = !camOn;
    for (final t in _localStream?.getVideoTracks() ?? const []) {
      t.enabled = camOn;
    }
    notifyListeners();
  }

  Future<void> leave() async {
    if (!_active) return;
    _active = false;
    sendSignal('group-call-leave', {'chatId': chatId, 'callId': callId});
    for (final id in participants.keys.toList()) {
      _dropPeer(id);
    }
    for (final t in _localStream?.getTracks() ?? const []) {
      await t.stop();
    }
    _localStream = null;
    localRenderer.srcObject = null;
    _setNativeCallActive(false);
    notifyListeners();
  }

  void _setNativeCallActive(bool active) {
    if (kIsWeb) return;
    try {
      _native.invokeMethod('setCallActive', active);
    } catch (_) {/* desktop / unsupported */}
  }

  @override
  void dispose() {
    localRenderer.dispose();
    super.dispose();
  }
}
