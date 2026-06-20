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

  /// 0.27.0: how many messages are pinned in this chat (drives the banner) and
  /// the server-synced draft text, so a half-typed message follows you across
  /// devices. Both are mutable so live socket updates can patch them in place.
  int pinnedCount;
  String draft;

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
    this.pinnedCount = 0,
    this.draft = '',
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

  /// Serialise for the on-device chat-list cache (round-trips through
  /// [Chat.fromJson]) so the list renders offline.
  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'title': title,
        'avatarColor': avatarColor,
        'memberIds': memberIds,
        'members': members.map((m) => m.toJson()).toList(),
        if (otherUser != null) 'otherUser': otherUser!.toJson(),
        if (ownerId != null) 'ownerId': ownerId,
        'self': self,
        'description': description,
        'hasAvatar': hasAvatar,
        'avatarVersion': avatarVersion,
        'locked': locked,
        'archived': archived,
        'expireSeconds': expireSeconds,
        if (lastMessage != null) 'lastMessage': lastMessage!.toJson(),
        'unread': unread,
        'muted': muted,
        'pinnedCount': pinnedCount,
        if (draft.isNotEmpty) 'draft': draft,
        'updatedAt': updatedAt,
      };

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
        pinnedCount: (json['pinnedCount'] ?? 0) as int,
        draft: (json['draft'] ?? '') as String,
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
    int? pinnedCount,
    String? draft,
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
        pinnedCount: pinnedCount ?? this.pinnedCount,
        draft: draft ?? this.draft,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
