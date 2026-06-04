import 'package:flutter/material.dart';
import 'message.dart';
import 'user.dart';

/// A conversation — either a 1:1 direct chat or a named group.
class Chat {
  final String id;
  final String type; // 'direct' | 'group'
  final String title;
  final String avatarColor;
  final List<String> memberIds;
  final List<PingUser> members; // populated for groups
  final PingUser? otherUser; // populated for direct chats
  final String? ownerId;
  Message? lastMessage;
  int unread;
  bool muted;
  final int updatedAt;

  Chat({
    required this.id,
    required this.type,
    required this.title,
    required this.avatarColor,
    required this.memberIds,
    required this.updatedAt,
    this.members = const [],
    this.otherUser,
    this.ownerId,
    this.lastMessage,
    this.unread = 0,
    this.muted = false,
  });

  bool get isGroup => type == 'group';

  Color get color {
    final hex = avatarColor.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  String get initials {
    final t = title.trim();
    if (t.isEmpty) return '?';
    final parts = t.split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return t.characters.take(2).toString().toUpperCase();
  }

  factory Chat.fromJson(Map<String, dynamic> json) => Chat(
        id: json['id'] as String,
        type: json['type'] as String,
        title: (json['title'] ?? 'Chat') as String,
        avatarColor: (json['avatarColor'] ?? '#5C6BC0') as String,
        memberIds:
            (json['memberIds'] as List?)?.map((e) => e as String).toList() ?? [],
        members: (json['members'] as List?)
                ?.map((e) => PingUser.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
        otherUser: json['otherUser'] != null
            ? PingUser.fromJson(json['otherUser'] as Map<String, dynamic>)
            : null,
        ownerId: json['ownerId'] as String?,
        lastMessage: json['lastMessage'] != null
            ? Message.fromJson(json['lastMessage'] as Map<String, dynamic>)
            : null,
        unread: (json['unread'] ?? 0) as int,
        muted: (json['muted'] ?? false) as bool,
        updatedAt: (json['updatedAt'] ?? json['createdAt'] ?? 0) as int,
      );

  Chat copyWith({
    String? title,
    Message? lastMessage,
    int? unread,
    bool? muted,
    int? updatedAt,
    PingUser? otherUser,
    List<PingUser>? members,
  }) =>
      Chat(
        id: id,
        type: type,
        title: title ?? this.title,
        avatarColor: avatarColor,
        memberIds: memberIds,
        members: members ?? this.members,
        otherUser: otherUser ?? this.otherUser,
        ownerId: ownerId,
        lastMessage: lastMessage ?? this.lastMessage,
        unread: unread ?? this.unread,
        muted: muted ?? this.muted,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
