import 'package:flutter/material.dart';

/// A person on Ping. Identity is the phone number; the colour is server-assigned
/// so avatars stay consistent across every device. [email]/[hasPassword] are
/// only populated for the signed-in user (the backup-login info).
class PingUser {
  final String id;
  final String phone;
  final String displayName;
  final String avatarColor;
  final String about;
  final bool hasAvatar;
  final int avatarVersion;
  final int? lastSeen;
  final bool online;
  final String? email;
  final bool hasPassword;
  final bool isAdmin;
  final String messageStorage; // 'server' (default) | 'local'
  final bool showLastSeen; // privacy: share "zuletzt online" (own account only)

  /// Trust badges shown next to the name everywhere. [official] is the system
  /// "Ping Team" account; [verified] is a Ping staff/admin check; [premium] is a
  /// Ping Premium member. At most one is rendered, in that priority order.
  final bool official;
  final bool verified;
  final bool premium;

  const PingUser({
    required this.id,
    required this.phone,
    required this.displayName,
    required this.avatarColor,
    this.about = '',
    this.hasAvatar = false,
    this.avatarVersion = 0,
    this.lastSeen,
    this.online = false,
    this.email,
    this.hasPassword = false,
    this.isAdmin = false,
    this.messageStorage = 'server',
    this.showLastSeen = true,
    this.official = false,
    this.verified = false,
    this.premium = false,
  });

  /// Whether this account carries any trust badge at all.
  bool get hasBadge => official || verified || premium;

  Color get color {
    final hex = avatarColor.replaceFirst('#', '');
    return Color(int.parse('FF$hex', radix: 16));
  }

  /// Whether the user has set a real name (rather than defaulting to the number).
  bool get hasName =>
      displayName.trim().isNotEmpty && displayName.trim() != phone;

  /// What to show as the primary label — the name, falling back to the number.
  String get label => hasName ? displayName.trim() : phone;

  /// Initials for the avatar fallback. Empty when there are no letters to use
  /// (e.g. a number-only account), so the avatar shows a person icon instead.
  String get initials {
    if (!hasName) return '';
    final parts =
        displayName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    final letters = displayName.trim().replaceAll(RegExp(r'[^A-Za-zÀ-ÿ]'), '');
    if (letters.isEmpty) return '';
    return letters.characters.take(2).toString().toUpperCase();
  }

  PingUser copyWith({
    String? displayName,
    String? about,
    String? avatarColor,
    bool? hasAvatar,
    int? avatarVersion,
    bool? online,
    int? lastSeen,
    String? email,
    bool? hasPassword,
    bool? isAdmin,
    String? messageStorage,
    bool? showLastSeen,
    bool? official,
    bool? verified,
    bool? premium,
  }) =>
      PingUser(
        id: id,
        phone: phone,
        displayName: displayName ?? this.displayName,
        avatarColor: avatarColor ?? this.avatarColor,
        about: about ?? this.about,
        hasAvatar: hasAvatar ?? this.hasAvatar,
        avatarVersion: avatarVersion ?? this.avatarVersion,
        lastSeen: lastSeen ?? this.lastSeen,
        online: online ?? this.online,
        email: email ?? this.email,
        hasPassword: hasPassword ?? this.hasPassword,
        isAdmin: isAdmin ?? this.isAdmin,
        messageStorage: messageStorage ?? this.messageStorage,
        showLastSeen: showLastSeen ?? this.showLastSeen,
        official: official ?? this.official,
        verified: verified ?? this.verified,
        premium: premium ?? this.premium,
      );

  /// Serialise for the on-device cache (round-trips through [PingUser.fromJson]).
  /// Used to keep the signed-in identity and chat peers available offline.
  Map<String, dynamic> toJson() => {
        'id': id,
        'phone': phone,
        'displayName': displayName,
        'avatarColor': avatarColor,
        'about': about,
        'hasAvatar': hasAvatar,
        'avatarVersion': avatarVersion,
        if (lastSeen != null) 'lastSeen': lastSeen,
        'online': online,
        if (email != null) 'email': email,
        'hasPassword': hasPassword,
        'isAdmin': isAdmin,
        'messageStorage': messageStorage,
        'showLastSeen': showLastSeen,
        'official': official,
        'verified': verified,
        'premium': premium,
      };

  factory PingUser.fromJson(Map<String, dynamic> json) => PingUser(
        id: json['id'] as String,
        phone: (json['phone'] ?? '') as String,
        displayName: (json['displayName'] ?? json['phone'] ?? '') as String,
        avatarColor: (json['avatarColor'] ?? '#5C6BC0') as String,
        about: (json['about'] ?? '') as String,
        hasAvatar: (json['hasAvatar'] ?? false) as bool,
        avatarVersion: (json['avatarVersion'] ?? 0) as int,
        lastSeen: json['lastSeen'] as int?,
        online: (json['online'] ?? false) as bool,
        email: json['email'] as String?,
        hasPassword: (json['hasPassword'] ?? false) as bool,
        isAdmin: (json['isAdmin'] ?? false) as bool,
        messageStorage: (json['messageStorage'] ?? 'server') as String,
        showLastSeen: (json['showLastSeen'] ?? true) as bool,
        official: (json['official'] ?? false) as bool,
        verified: (json['verified'] ?? false) as bool,
        premium: (json['premium'] ?? false) as bool,
      );
}

/// A registered Ping user that matched one of the device-contact identifiers we
/// uploaded. [phone]/[email] echo back whichever of *our own* identifiers hit,
/// so the UI can label the match with the local contact it came from.
class ContactMatch {
  final PingUser user;
  final String? phone;
  final String? email;

  const ContactMatch({required this.user, this.phone, this.email});

  factory ContactMatch.fromJson(Map<String, dynamic> json) => ContactMatch(
        user: PingUser.fromJson(json['user'] as Map<String, dynamic>),
        phone: json['phone'] as String?,
        email: json['email'] as String?,
      );
}
