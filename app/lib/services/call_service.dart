import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/user.dart';
import 'ringtone_service.dart';

enum CallState { idle, outgoing, incoming, connecting, active, ended }

/// How a call finished, for the call log.
enum CallOutcome { completed, missed, declined, canceled, failed }

/// A finished call, handed to [CallController.onLogged] so the app can persist it
/// to the server-side call history.
class CallLog {
  final PingUser peer;
  final String callId;
  final bool outgoing;
  final bool video;
  final CallOutcome outcome;
  final Duration duration;

  const CallLog({
    required this.peer,
    required this.callId,
    required this.outgoing,
    required this.video,
    required this.outcome,
    required this.duration,
  });

  String get outcomeName => outcome.name;
  String get directionName => outgoing ? 'outgoing' : 'incoming';
}

/// How long an unanswered call rings before it gives up on its own.
const _ringTimeout = Duration(seconds: 45);

/// Drives a 1:1 WebRTC voice/video call: owns the peer connection, the local and
/// remote media, the ring tones, the live duration and the small state machine.
/// Signaling (offer/answer/ICE/hang-up) flows in and out through [sendSignal] /
/// the on*… handlers, which the app wires to the WebSocket. ICE servers come
/// from [fetchIce] (`/api/ice`).
class CallController extends ChangeNotifier {
  final void Function(String type, Map<String, dynamic> payload) sendSignal;
  final Future<List<Map<String, dynamic>>> Function() fetchIce;

  /// Invoked once per finished call so the app can write the call history.
  void Function(CallLog log)? onLogged;

  CallController({required this.sendSignal, required this.fetchIce});

  CallState state = CallState.idle;
  PingUser? peer; // the other party
  bool video = false;
  bool muted = false;
  bool speakerOn = true;
  bool incomingIsVideo = false;

  /// Whether call ring tones / ringback should sound. Mirrors the user's
  /// `callRingtone` setting; kept in sync by [AppState].
  bool ringtoneEnabled = true;

  final RTCVideoRenderer localRenderer = RTCVideoRenderer();
  final RTCVideoRenderer remoteRenderer = RTCVideoRenderer();
  final RingtoneService _ring = RingtoneService();
  static const _native = MethodChannel('ping/native');

  /// Ask the host activity to show over the lock screen + keep the screen awake
  /// while a call is on (and release it afterwards). Android-only; best-effort.
  void _setNativeCallActive(bool active) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    _native.invokeMethod('setCallActive', active).catchError((_) {});
  }

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  final List<RTCIceCandidate> _pendingCandidates = [];
  String? _callId;
  bool _renderersReady = false;
  bool _remoteDescSet = false;
  Map<String, dynamic>? _incomingOffer;

  // Direction + lifecycle bookkeeping for the call log and the live timer.
  bool _outgoing = false;
  bool _wasActive = false;
  DateTime? _connectedAt;
  Duration _finalDuration = Duration.zero;
  String? _localOfferSdp; // cached so we can re-send when the callee comes online
  Timer? _ticker;
  Timer? _timeout;
  bool _logged = false;

  bool get inCall => state != CallState.idle && state != CallState.ended;
  bool get isOutgoing => _outgoing;
  String? get currentCallId => _callId;

  /// Live call duration, ticking every second while connected.
  Duration get elapsed {
    if (_connectedAt == null) return _finalDuration;
    if (state == CallState.active) return DateTime.now().difference(_connectedAt!);
    return _finalDuration;
  }

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
        _markConnected();
      } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        _cleanup(CallState.ended, CallOutcome.failed);
      } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        _cleanup(CallState.ended, _wasActive ? CallOutcome.completed : CallOutcome.failed);
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

  void _markConnected() {
    if (state == CallState.active) return;
    _ring.stop();
    _wasActive = true;
    _connectedAt = DateTime.now();
    _timeout?.cancel();
    state = CallState.active;
    _ticker?.cancel();
    // Tick the live duration once a second.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (state == CallState.active) notifyListeners();
    });
    notifyListeners();
  }

  void _armRingTimeout() {
    _timeout?.cancel();
    _timeout = Timer(_ringTimeout, () {
      if (!_wasActive && inCall) {
        // Nobody picked up in time.
        final target = peer;
        if (target != null) {
          sendSignal(_outgoing ? 'call-end' : 'call-reject',
              {'to': target.id, 'callId': _callId, 'reason': 'timeout'});
        }
        _cleanup(CallState.ended, CallOutcome.missed);
      }
    });
  }

  // ---- Outgoing call ----
  Future<void> startCall(PingUser target, {required bool video}) async {
    if (inCall) return;
    _resetBookkeeping();
    peer = target;
    this.video = video;
    _outgoing = true;
    muted = false;
    speakerOn = video; // video calls default to loudspeaker
    _callId = DateTime.now().microsecondsSinceEpoch.toString();
    _remoteDescSet = false;
    state = CallState.outgoing;
    notifyListeners();
    _setNativeCallActive(true);
    if (ringtoneEnabled) _ring.startOutgoing();
    _armRingTimeout();
    await _ensureRenderers();
    await _createPeer();
    final offer = await _pc!.createOffer({
      'offerToReceiveAudio': true,
      'offerToReceiveVideo': video,
    });
    await _pc!.setLocalDescription(offer);
    _localOfferSdp = offer.sdp;
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
    final callId = payload['callId']?.toString();
    if (inCall) {
      // Same call re-offered (the caller learned we just came online) → refresh
      // the stored offer so Accept works; a *different* call while busy is
      // auto-declined so the caller isn't left hanging.
      if (callId != null && callId == _callId && state == CallState.incoming) {
        _incomingOffer = payload;
      } else {
        sendSignal('call-reject', {
          'to': from.id,
          'callId': callId,
          'reason': 'busy',
        });
      }
      return;
    }
    _resetBookkeeping();
    peer = from;
    _outgoing = false;
    incomingIsVideo = payload['video'] == true;
    video = incomingIsVideo;
    _callId = callId;
    _incomingOffer = payload;
    _remoteDescSet = false;
    state = CallState.incoming;
    notifyListeners();
    _setNativeCallActive(true);
    if (ringtoneEnabled) _ring.startIncoming();
    _armRingTimeout();
  }

  /// The callee was woken by a push but the WebSocket offer hasn't arrived yet.
  /// Ask the caller (who is still ringing) to re-send it.
  void requestOffer(String callId, String callerId) {
    sendSignal('call-ready', {'to': callerId, 'callId': callId});
  }

  /// Caller side: the callee just signalled it is ready to receive the offer
  /// (it came online via a push). Re-send our pending offer.
  void onRemoteReady(Map<String, dynamic> payload) {
    final callId = payload['callId']?.toString();
    final target = peer;
    if (_outgoing &&
        state == CallState.outgoing &&
        target != null &&
        callId == _callId &&
        _localOfferSdp != null) {
      sendSignal('call-offer', {
        'to': target.id,
        'callId': _callId,
        'sdp': _localOfferSdp,
        'video': video,
      });
    }
  }

  Future<void> acceptCall() async {
    final offer = _incomingOffer;
    final target = peer;
    if (state != CallState.incoming || offer == null || target == null) return;
    muted = false;
    speakerOn = video;
    _ring.stop();
    _timeout?.cancel();
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
    // Give the connection a fresh window to come up after answering.
    _armRingTimeout();
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
    _cleanup(CallState.ended, CallOutcome.declined);
  }

  // ---- Signaling from the other side ----
  Future<void> onRemoteAnswer(Map<String, dynamic> payload) async {
    if (_pc == null) return;
    _ring.stop();
    await _pc!.setRemoteDescription(
        RTCSessionDescription(payload['sdp'] as String?, 'answer'));
    _remoteDescSet = true;
    await _flushCandidates();
    if (state == CallState.outgoing) {
      state = CallState.connecting;
      notifyListeners();
    }
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

  void onRemoteReject(Map<String, dynamic> payload) =>
      _cleanup(CallState.ended, CallOutcome.declined);

  void onRemoteEnd(Map<String, dynamic> payload) {
    // The other side hung up. If they hung up while we were still ringing (we
    // never answered), that's a *missed* call for us.
    final outcome = _wasActive
        ? CallOutcome.completed
        : (_outgoing ? CallOutcome.canceled : CallOutcome.missed);
    _cleanup(CallState.ended, outcome);
  }

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

  /// Turn the local camera on/off mid-call (video calls only).
  void toggleCamera() {
    final tracks = _localStream?.getVideoTracks() ?? const [];
    if (tracks.isEmpty) return;
    final on = !tracks.first.enabled;
    for (final t in tracks) {
      t.enabled = on;
    }
    notifyListeners();
  }

  bool get cameraOn {
    final tracks = _localStream?.getVideoTracks() ?? const [];
    return tracks.isNotEmpty && tracks.first.enabled;
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
    final outcome = _wasActive
        ? CallOutcome.completed
        : (_outgoing ? CallOutcome.canceled : CallOutcome.declined);
    _cleanup(CallState.ended, outcome);
  }

  void _resetBookkeeping() {
    _outgoing = false;
    _wasActive = false;
    _connectedAt = null;
    _finalDuration = Duration.zero;
    _localOfferSdp = null;
    _logged = false;
    _ticker?.cancel();
    _timeout?.cancel();
  }

  void _log(CallOutcome outcome) {
    if (_logged) return;
    final p = peer;
    final id = _callId;
    if (p == null || id == null) return;
    _logged = true;
    onLogged?.call(CallLog(
      peer: p,
      callId: id,
      outgoing: _outgoing,
      video: video,
      outcome: outcome,
      duration: _finalDuration,
    ));
  }

  Future<void> _cleanup(CallState end, CallOutcome outcome) async {
    if (state == CallState.idle) return;
    _finalDuration =
        _connectedAt != null ? DateTime.now().difference(_connectedAt!) : Duration.zero;
    _ticker?.cancel();
    _timeout?.cancel();
    await _ring.stop();
    _setNativeCallActive(false);
    _log(outcome);
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
      _connectedAt = null;
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _timeout?.cancel();
    _ring.dispose();
    localRenderer.dispose();
    remoteRenderer.dispose();
    _pc?.close();
    _localStream?.dispose();
    super.dispose();
  }
}
