import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/call_service.dart';
import '../widgets/avatar.dart';

/// Sits above the whole app and shows the full-screen call UI whenever a call is
/// ringing or connected. Mounted from `MaterialApp.builder`.
class CallOverlay extends StatelessWidget {
  final Widget child;
  const CallOverlay({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final controller = context.read<AppState>().callController;
    return Stack(
      children: [
        child,
        ListenableBuilder(
          listenable: controller,
          builder: (_, _) => controller.inCall
              ? Positioned.fill(child: CallScreen(controller: controller))
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

class CallScreen extends StatelessWidget {
  final CallController controller;
  const CallScreen({super.key, required this.controller});

  String get _statusText {
    switch (controller.state) {
      case CallState.incoming:
        return controller.incomingIsVideo
            ? 'Eingehender Videoanruf'
            : 'Eingehender Anruf';
      case CallState.outgoing:
        return 'Ruft an …';
      case CallState.connecting:
        return 'Verbinde …';
      case CallState.active:
        return 'Verbunden';
      case CallState.ended:
        return 'Beendet';
      case CallState.idle:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final peer = controller.peer;
    final showRemoteVideo = controller.video &&
        controller.state == CallState.active &&
        controller.remoteRenderer.srcObject != null;

    return Material(
      color: Colors.black,
      child: Stack(
        children: [
          // Remote video (cover) or the peer's avatar + name.
          if (showRemoteVideo)
            Positioned.fill(
              child: RTCVideoView(
                controller.remoteRenderer,
                objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              ),
            )
          else
            Positioned.fill(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (peer != null)
                    PingAvatar(
                      initials: peer.initials,
                      color: peer.color,
                      size: 116,
                      imageUrl: state.avatarUrl(peer),
                      imageHeaders: state.authHeaders,
                    ),
                  const SizedBox(height: 24),
                  Text(
                    peer?.label ?? 'Anruf',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Text(_statusText,
                      style: const TextStyle(color: Colors.white70, fontSize: 15)),
                ],
              ),
            ),

          // Local video preview (picture-in-picture) for video calls.
          if (controller.video &&
              controller.state != CallState.incoming &&
              controller.localRenderer.srcObject != null)
            Positioned(
              right: 16,
              top: MediaQuery.of(context).padding.top + 16,
              width: 110,
              height: 160,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: RTCVideoView(
                  controller.localRenderer,
                  mirror: true,
                  objectFit:
                      RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                ),
              ),
            ),

          // When video is on, keep the name/status readable up top.
          if (showRemoteVideo)
            Positioned(
              top: MediaQuery.of(context).padding.top + 20,
              left: 20,
              child: Text(
                '${peer?.label ?? ''} · $_statusText',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    shadows: [Shadow(blurRadius: 8, color: Colors.black)]),
              ),
            ),

          // Controls.
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 28),
                child: controller.state == CallState.incoming
                    ? _incomingControls()
                    : _activeControls(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _incomingControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _CircleButton(
          icon: Icons.call_end_rounded,
          color: Colors.red,
          label: 'Ablehnen',
          onTap: controller.rejectCall,
        ),
        _CircleButton(
          icon: Icons.call_rounded,
          color: Colors.green,
          label: 'Annehmen',
          onTap: controller.acceptCall,
        ),
      ],
    );
  }

  Widget _activeControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _CircleButton(
          icon: controller.muted ? Icons.mic_off_rounded : Icons.mic_rounded,
          color: controller.muted ? Colors.white24 : Colors.white12,
          label: 'Stumm',
          onTap: controller.toggleMute,
        ),
        if (controller.video)
          _CircleButton(
            icon: Icons.cameraswitch_rounded,
            color: Colors.white12,
            label: 'Kamera',
            onTap: controller.switchCamera,
          )
        else
          _CircleButton(
            icon: controller.speakerOn
                ? Icons.volume_up_rounded
                : Icons.volume_down_rounded,
            color: controller.speakerOn ? Colors.white24 : Colors.white12,
            label: 'Laut',
            onTap: controller.toggleSpeaker,
          ),
        _CircleButton(
          icon: Icons.call_end_rounded,
          color: Colors.red,
          label: 'Auflegen',
          onTap: controller.hangUp,
        ),
      ],
    );
  }
}

class _CircleButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;
  const _CircleButton({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Icon(icon, color: Colors.white, size: 28),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }
}
