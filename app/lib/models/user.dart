import 'package:flutter/material.dart';

/// A person on Ping. The colour is server-assigned so avatars stay consistent
/// across every device.
class PingUser {
  final String id;
  final String username;
  final String displayName;
  final String avatarColor;
  final String about;
  final int? lastSeen;
  final bool online;

  const PingUser({
    required this.id,
    required this.username,
    required this.displayName,
    required this.avatarColor,
    this.about = '',
    this.lastSeen,
    this.online = false,
  });

  Color get color {
    final hex = avatarColor.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  /// First letter(s) used for the avatar fallback.
  String get initials {
    final name = displayName.trim().isEmpty ? username : displayName.trim();
    final parts = name.split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.characters.take(2).toString().toUpperCase();
  }

  PingUser copyWith({bool? online, int? lastSeen}) => PingUser(
        id: id,
        username: username,
        displayName: displayName,
        avatarColor: avatarColor,
        about: about,
        lastSeen: lastSeen ?? this.lastSeen,
        online: online ?? this.online,
      );

  factory PingUser.fromJson(Map<String, dynamic> json) => PingUser(
        id: json['id'] as String,
        username: json['username'] as String,
        displayName: (json['displayName'] ?? json['username']) as String,
        avatarColor: (json['avatarColor'] ?? '#5C6BC0') as String,
        about: (json['about'] ?? '') as String,
        lastSeen: json['lastSeen'] as int?,
        online: (json['online'] ?? false) as bool,
      );
}
