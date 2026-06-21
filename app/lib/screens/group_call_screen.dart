import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../services/group_call_service.dart';

/// The full-mesh group-call UI (0.34.0): a tile grid with the local preview and
/// one tile per connected participant, plus mic/camera/leave controls. Driven by
/// [GroupCallController]; pops itself when the call ends. Gated behind the
/// `groupCalls` flag — validate on real devices before enabling.
class GroupCallScreen extends StatelessWidget {
  const GroupCallScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ctrl = context.read<AppState>().groupCall;
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) ctrl.leave();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0D0F13),
        body: SafeArea(
          child: AnimatedBuilder(
            animation: ctrl,
            builder: (context, _) {
              if (!ctrl.isActive) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (Navigator.of(context).canPop()) Navigator.of(context).pop();
                });
              }
              final tiles = <Widget>[
                _Tile(
                  renderer: ctrl.localRenderer,
                  label: 'Du',
                  muted: !ctrl.micOn,
                ),
                for (final p in ctrl.participants.values)
                  _Tile(
                    renderer: p.renderer,
                    label: p.name,
                    connecting: !p.connected,
                  ),
              ];
              final cols = tiles.length <= 1 ? 1 : 2;
              return Column(
                children: [
                  const SizedBox(height: 8),
                  Text(
                    '${tiles.length} im Anruf',
                    style: const TextStyle(
                        color: Colors.white70, fontWeight: FontWeight.w600),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: GridView.count(
                        crossAxisCount: cols,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        childAspectRatio: 0.75,
                        children: tiles,
                      ),
                    ),
                  ),
                  _Controls(ctrl: ctrl),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final RTCVideoRenderer renderer;
  final String label;
  final bool muted;
  final bool connecting;
  const _Tile({
    required this.renderer,
    required this.label,
    this.muted = false,
    this.connecting = false,
  });

  @override
  Widget build(BuildContext context) {
    final hasVideo = renderer.srcObject != null;
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Container(color: const Color(0xFF1B2029)),
          if (hasVideo)
            RTCVideoView(
              renderer,
              objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              mirror: label == 'Du',
            )
          else
            Center(
              child: CircleAvatar(
                radius: 30,
                backgroundColor: Colors.white12,
                child: Text(
                  label.isNotEmpty ? label[0].toUpperCase() : '?',
                  style: const TextStyle(color: Colors.white, fontSize: 24),
                ),
              ),
            ),
          if (connecting)
            const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          Positioned(
            left: 8,
            bottom: 8,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(label,
                      style: const TextStyle(
                          color: Colors.white, fontSize: 12.5)),
                ),
                if (muted)
                  const Padding(
                    padding: EdgeInsets.only(left: 4),
                    child: Icon(Icons.mic_off_rounded,
                        color: Colors.redAccent, size: 16),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Controls extends StatelessWidget {
  final GroupCallController ctrl;
  const _Controls({required this.ctrl});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _round(
            icon: ctrl.micOn ? Icons.mic_rounded : Icons.mic_off_rounded,
            color: ctrl.micOn ? Colors.white24 : Colors.white,
            fg: ctrl.micOn ? Colors.white : Colors.black,
            onTap: ctrl.toggleMic,
          ),
          if (ctrl.video) ...[
            const SizedBox(width: 20),
            _round(
              icon: ctrl.camOn
                  ? Icons.videocam_rounded
                  : Icons.videocam_off_rounded,
              color: ctrl.camOn ? Colors.white24 : Colors.white,
              fg: ctrl.camOn ? Colors.white : Colors.black,
              onTap: ctrl.toggleCam,
            ),
          ],
          const SizedBox(width: 20),
          _round(
            icon: Icons.call_end_rounded,
            color: Colors.red,
            fg: Colors.white,
            onTap: () async {
              await ctrl.leave();
              if (context.mounted && Navigator.of(context).canPop()) {
                Navigator.of(context).pop();
              }
            },
          ),
        ],
      ),
    );
  }

  Widget _round({
    required IconData icon,
    required Color color,
    required Color fg,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 58,
        height: 58,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: Icon(icon, color: fg, size: 26),
      ),
    );
  }
}
