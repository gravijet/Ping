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
  final bool self; // true for the "note to self" chat
  final String description; // groups: optional description
  final bool hasAvatar; // groups: an uploaded group picture exists
  final int avatarVersion; // groups: cache-buster for the group picture
  final bool locked; // read-only channel (official "Ping Team" broadcast)
  final bool archived; // collapsed into the "Archiviert" section (per user)
  final int expireSeconds; // disappearing-messages timer (0 = off)
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
    this.self = false,
    this.description = '',
    this.hasAvatar = false,
    this.avatarVersion = 0,
    this.locked = false,
    this.archived = false,
    this.expireSeconds = 0,
    this.lastMessage,
    this.unread = 0,
    this.muted = false,
  });

  bool get isGroup => type == 'group';

  /// Title to display: the self-chat reads "Notiz an mich" instead of your name.
  String get displayTitle => self ? 'Notiz an mich' : title;

  Color get color {
    final hex = avatarColor.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  String get initials {
    final t = title.trim();
    if (t.isEmpty) return '';
    final parts = t.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    // Strip non-letters so a phone-number title doesn't yield "+4".
    final letters = t.replaceAll(RegExp(r'[^A-Za-zÀ-ÿ]'), '');
    if (letters.isEmpty) return '';
    return letters.characters.take(2).toString().toUpperCase();
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
        self: (json['self'] ?? false) as bool,
        description: (json['description'] ?? '') as String,
        hasAvatar: (json['hasAvatar'] ?? false) as bool,
        avatarVersion: (json['avatarVersion'] ?? 0) as int,
        locked: (json['locked'] ?? false) as bool,
        archived: (json['archived'] ?? false) as bool,
        expireSeconds: (json['expireSeconds'] ?? 0) as int,
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
    bool? archived,
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
        self: self,
        description: description,
        hasAvatar: hasAvatar,
        avatarVersion: avatarVersion,
        locked: locked,
        archived: archived ?? this.archived,
        expireSeconds: expireSeconds,
        lastMessage: lastMessage ?? this.lastMessage,
        unread: unread ?? this.unread,
        muted: muted ?? this.muted,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
