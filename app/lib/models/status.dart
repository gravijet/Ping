import 'package:flutter/material.dart';

import 'message.dart';
import 'user.dart';

/// A single status update ("story"). Text statuses carry [body] + [bgColor];
/// image statuses carry an [attachment] and an optional caption in [body].
class PingStatus {
  final String id;
  final String userId;
  final String type; // text | image
  final String body;
  final Attachment? attachment;
  final String? bgColor;
  final int createdAt;
  final int expiresAt;
  final bool seen;
  final int? viewCount; // only for the owner

  const PingStatus({
    required this.id,
    required this.userId,
    required this.type,
    required this.body,
    required this.createdAt,
    required this.expiresAt,
    this.attachment,
    this.bgColor,
    this.seen = false,
    this.viewCount,
  });

  bool get isImage => type == 'image';
  bool get isVideo => type == 'video';
  bool get isMedia => type != 'text';

  PingStatus copyWith({bool? seen, int? viewCount}) => PingStatus(
        id: id,
        userId: userId,
        type: type,
        body: body,
        attachment: attachment,
        bgColor: bgColor,
        createdAt: createdAt,
        expiresAt: expiresAt,
        seen: seen ?? this.seen,
        viewCount: viewCount ?? this.viewCount,
      );

  Color get background {
    final hex = (bgColor ?? '#0A84FF').replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  factory PingStatus.fromJson(Map<String, dynamic> json) => PingStatus(
        id: json['id'] as String,
        userId: json['userId'] as String,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        attachment: json['attachment'] != null
            ? Attachment.fromJson(json['attachment'] as Map<String, dynamic>)
            : null,
        bgColor: json['bgColor'] as String?,
        createdAt: json['createdAt'] as int,
        expiresAt: json['expiresAt'] as int,
        seen: (json['seen'] ?? false) as bool,
        viewCount: json['viewCount'] as int?,
      );
}

/// One contact's stack of active statuses, plus whether any are unseen.
class StatusGroup {
  final PingUser user;
  final List<PingStatus> items;
  final bool hasUnseen;
  final int updatedAt;

  const StatusGroup({
    required this.user,
    required this.items,
    required this.hasUnseen,
    required this.updatedAt,
  });

  /// Index of the first not-yet-seen item, or 0 when everything is seen (so the
  /// viewer replays from the start). Skips statuses you've already watched.
  int get firstUnseen {
    final i = items.indexWhere((s) => !s.seen);
    return i < 0 ? 0 : i;
  }

  StatusGroup copyWith({List<PingStatus>? items, bool? hasUnseen}) => StatusGroup(
        user: user,
        items: items ?? this.items,
        hasUnseen: hasUnseen ?? this.hasUnseen,
        updatedAt: updatedAt,
      );

  factory StatusGroup.fromJson(Map<String, dynamic> json) => StatusGroup(
        user: PingUser.fromJson(json['user'] as Map<String, dynamic>),
        items: (json['items'] as List)
            .map((e) => PingStatus.fromJson(e as Map<String, dynamic>))
            .toList(),
        hasUnseen: (json['hasUnseen'] ?? false) as bool,
        updatedAt: (json['updatedAt'] ?? 0) as int,
      );
}

/// A viewer entry for the owner's "seen by" list.
class StatusViewer {
  final PingUser user;
  final int viewedAt;
  const StatusViewer({required this.user, required this.viewedAt});

  factory StatusViewer.fromJson(Map<String, dynamic> json) => StatusViewer(
        user: PingUser.fromJson(json['user'] as Map<String, dynamic>),
        viewedAt: (json['viewedAt'] ?? 0) as int,
      );
}
