import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/user.dart';

enum CallState { idle, outgoing, incoming, connecting, active, ended }

/// Drives a 1:1 WebRTC voice/video call: owns the peer connection, the local and
/// remote media, and the small state machine. Signaling (offer/answer/ICE/
/// hang-up) flows in and out through [sendSignal] / the on*… handlers, which the
/// app wires to the WebSocket. ICE servers come from [fetchIce] (`/api/ice`).
class CallController extends ChangeNotifier {
  final void Function(String type, Map<String, dynamic> payload) sendSignal;
  final Future<List<Map<String, dynamic>>> Function() fetchIce;

  CallController({required this.sendSignal, required this.fetchIce});

  CallState state = CallState.idle;
  PingUser? peer; // the other party
  bool video = false;
  bool muted = false;
  bool speakerOn = true;
  bool incomingIsVideo = false;

  final RTCVideoRenderer localRenderer = RTCVideoRenderer();
  final RTCVideoRenderer remoteRenderer = RTCVideoRenderer();

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  final List<RTCIceCandidate> _pendingCandidates = [];
  String? _callId;
  bool _renderersReady = false;
  bool _remoteDescSet = false;
  Map<String, dynamic>? _incomingOffer;

  bool get inCall => state != CallState.idle && state != CallState.ended;

  Future<void> _ensureRenderers() async {
    if (_renderersReady) return;
    await localRenderer.initialize();
    await remoteRenderer.initialize();
    _renderersReady = true;
  }

  Future<List<Map<String, dynamic>>> _ice() async {
    try {
      final servers = await fetchIce();
      if (servers.isNotEmpty) return servers;
    } catch (_) {
      /* fall through to the public STUN default */
    }
    return [
      {'urls': 'stun:stun.l.google.com:19302'},
    ];
  }

  Future<void> _createPeer() async {
    final pc = await createPeerConnection({
      'iceServers': await _ice(),
      'sdpSemantics': 'unified-plan',
    });
    _pc = pc;

    pc.onIceCandidate = (candidate) {
      final target = peer;
      if (candidate.candidate != null && target != null) {
        sendSignal('call-ice', {
          'to': target.id,
          'callId': _callId,
          'candidate': candidate.toMap(),
        });
      }
    };
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        remoteRenderer.srcObject = event.streams.first;
        notifyListeners();
      }
    };
    pc.onConnectionState = (s) {
      if (s == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        state = CallState.active;
        notifyListeners();
      } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        _cleanup(CallState.ended);
      }
    };

    final stream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': video ? {'facingMode': 'user'} : false,
    });
    _localStream = stream;
    localRenderer.srcObject = stream;
    for (final track in stream.getTracks()) {
      await pc.addTrack(track, stream);
    }
    notifyListeners();
  }

  // ---- Outgoing call ----
  Future<void> startCall(PingUser target, {required bool video}) async {
    if (inCall) return;
    peer = target;
    this.video = video;
    muted = false;
    speakerOn = video; // video calls default to loudspeaker
    _callId = DateTime.now().microsecondsSinceEpoch.toString();
    _remoteDescSet = false;
    state = CallState.outgoing;
    notifyListeners();
    await _ensureRenderers();
    await _createPeer();
    final offer = await _pc!.createOffer({
      'offerToReceiveAudio': true,
      'offerToReceiveVideo': video,
    });
    await _pc!.setLocalDescription(offer);
    Helper.setSpeakerphoneOn(speakerOn);
    sendSignal('call-offer', {
      'to': target.id,
      'callId': _callId,
      'sdp': offer.sdp,
      'video': video,
    });
  }

  // ---- Incoming call ----
  void onIncomingOffer(PingUser from, Map<String, dynamic> payload) {
    if (inCall) {
      // Already busy → auto-decline so the caller isn't left hanging.
      sendSignal('call-reject', {
        'to': from.id,
        'callId': payload['callId'],
        'reason': 'busy',
      });
      return;
    }
    peer = from;
    incomingIsVideo = payload['video'] == true;
    video = incomingIsVideo;
    _callId = payload['callId']?.toString();
    _incomingOffer = payload;
    _remoteDescSet = false;
    state = CallState.incoming;
    notifyListeners();
  }

  Future<void> acceptCall() async {
    final offer = _incomingOffer;
    final target = peer;
    if (state != CallState.incoming || offer == null || target == null) return;
    muted = false;
    speakerOn = video;
    state = CallState.connecting;
    notifyListeners();
    await _ensureRenderers();
    await _createPeer();
    await _pc!.setRemoteDescription(
        RTCSessionDescription(offer['sdp'] as String?, 'offer'));
    _remoteDescSet = true;
    await _flushCandidates();
    final answer = await _pc!.createAnswer();
    await _pc!.setLocalDescription(answer);
    Helper.setSpeakerphoneOn(speakerOn);
    sendSignal('call-answer', {
      'to': target.id,
      'callId': _callId,
      'sdp': answer.sdp,
    });
  }

  void rejectCall() {
    final target = peer;
    if (target != null) {
      sendSignal('call-reject', {
        'to': target.id,
        'callId': _callId,
        'reason': 'declined',
      });
    }
    _cleanup(CallState.ended);
  }

  // ---- Signaling from the other side ----
  Future<void> onRemoteAnswer(Map<String, dynamic> payload) async {
    if (_pc == null) return;
    await _pc!.setRemoteDescription(
        RTCSessionDescription(payload['sdp'] as String?, 'answer'));
    _remoteDescSet = true;
    await _flushCandidates();
    state = CallState.connecting;
    notifyListeners();
  }

  Future<void> onRemoteIce(Map<String, dynamic> payload) async {
    final map = payload['candidate'];
    if (map is! Map) return;
    final cand = RTCIceCandidate(
      map['candidate'] as String?,
      map['sdpMid'] as String?,
      (map['sdpMLineIndex'] as num?)?.toInt(),
    );
    if (_pc == null || !_remoteDescSet) {
      _pendingCandidates.add(cand);
    } else {
      await _pc!.addCandidate(cand);
    }
  }

  void onRemoteReject(Map<String, dynamic> payload) => _cleanup(CallState.ended);
  void onRemoteEnd(Map<String, dynamic> payload) => _cleanup(CallState.ended);

  Future<void> _flushCandidates() async {
    for (final c in _pendingCandidates) {
      try {
        await _pc!.addCandidate(c);
      } catch (_) {
        /* ignore a stray candidate */
      }
    }
    _pendingCandidates.clear();
  }

  // ---- In-call controls ----
  void toggleMute() {
    muted = !muted;
    for (final t in _localStream?.getAudioTracks() ?? const []) {
      t.enabled = !muted;
    }
    notifyListeners();
  }

  Future<void> switchCamera() async {
    final tracks = _localStream?.getVideoTracks() ?? const [];
    if (tracks.isNotEmpty) {
      await Helper.switchCamera(tracks.first);
    }
  }

  void toggleSpeaker() {
    speakerOn = !speakerOn;
    Helper.setSpeakerphoneOn(speakerOn);
    notifyListeners();
  }

  void hangUp() {
    final target = peer;
    if (target != null) {
      sendSignal('call-end', {'to': target.id, 'callId': _callId});
    }
    _cleanup(CallState.ended);
  }

  Future<void> _cleanup(CallState end) async {
    if (state == CallState.idle) return;
    state = end;
    notifyListeners();
    try {
      await _localStream?.dispose();
    } catch (_) {/* ignore */}
    try {
      await _pc?.close();
    } catch (_) {/* ignore */}
    _pc = null;
    _localStream = null;
    localRenderer.srcObject = null;
    remoteRenderer.srcObject = null;
    _incomingOffer = null;
    _remoteDescSet = false;
    _pendingCandidates.clear();
    // Briefly show the "ended" state, then return to idle.
    Future.delayed(const Duration(milliseconds: 700), () {
      state = CallState.idle;
      peer = null;
      _callId = null;
      muted = false;
      video = false;
      notifyListeners();
    });
  }

  @override
  void dispose() {
    localRenderer.dispose();
    remoteRenderer.dispose();
    _pc?.close();
    _localStream?.dispose();
    super.dispose();
  }
}
