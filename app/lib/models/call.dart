import 'user.dart';

/// One entry in the call history (the current user's own log of a call).
class CallEntry {
  final String id;
  final String callId;
  final String direction; // 'incoming' | 'outgoing'
  final bool video;
  final String outcome; // completed | missed | declined | canceled | failed
  final int duration; // seconds
  final int createdAt;
  final PingUser peer;

  const CallEntry({
    required this.id,
    required this.callId,
    required this.direction,
    required this.video,
    required this.outcome,
    required this.duration,
    required this.createdAt,
    required this.peer,
  });

  bool get incoming => direction == 'incoming';
  bool get missed => outcome == 'missed';
  bool get connected => outcome == 'completed';

  factory CallEntry.fromJson(Map<String, dynamic> json) => CallEntry(
        id: json['id'] as String,
        callId: (json['callId'] ?? '') as String,
        direction: (json['direction'] ?? 'outgoing') as String,
        video: (json['video'] ?? false) as bool,
        outcome: (json['outcome'] ?? 'completed') as String,
        duration: (json['duration'] ?? 0) as int,
        createdAt: (json['createdAt'] ?? 0) as int,
        peer: PingUser.fromJson(json['peer'] as Map<String, dynamic>),
      );
}
