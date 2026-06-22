import 'package:flutter/material.dart';

/// Parse a `#rrggbb` (or `rrggbb`) colour string into an opaque [Color],
/// tolerating empty / malformed values so bad server data can never crash a
/// build. Falls back to [fallback] (a muted grey by default).
Color _hexColor(String? value, {Color fallback = const Color(0xFF888888)}) {
  final hex = (value ?? '').replaceFirst('#', '').trim();
  if (hex.length != 6) return fallback;
  final n = int.tryParse(hex, radix: 16);
  return n == null ? fallback : Color(0xFF000000 | n);
}

/// A tappable link chip on a profile (e.g. a website or social handle).
class ProfileLink {
  final String label;
  final String url;
  const ProfileLink({required this.label, required this.url});

  /// A human label for the chip — the explicit label, or the URL's host.
  String get display {
    if (label.trim().isNotEmpty) return label.trim();
    final uri = Uri.tryParse(url);
    final host = uri?.host ?? '';
    return host.isNotEmpty ? host.replaceFirst('www.', '') : url;
  }

  Map<String, dynamic> toJson() => {'label': label, 'url': url};

  factory ProfileLink.fromJson(Map<String, dynamic> j) => ProfileLink(
        label: (j['label'] ?? '').toString(),
        url: (j['url'] ?? '').toString(),
      );
}

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

  // ---- Rich profile customization ----
  final String? accentColor; // personal accent (hex) or null → use avatarColor
  final bool hasBanner; // a profile background image is set
  final int bannerVersion; // cache-buster for the banner
  final String pronouns;
  final String birthday; // 'YYYY-MM-DD' or 'MM-DD' or ''
  final String city;
  final List<ProfileLink> links;
  final String moodEmoji; // temporary status emoji
  final String moodText; // temporary status text
  final int? moodUntil; // epoch ms the mood expires (null = until cleared)

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
    this.accentColor,
    this.hasBanner = false,
    this.bannerVersion = 0,
    this.pronouns = '',
    this.birthday = '',
    this.city = '',
    this.links = const [],
    this.moodEmoji = '',
    this.moodText = '',
    this.moodUntil,
    this.official = false,
    this.verified = false,
    this.premium = false,
  });

  /// Whether this account carries any trust badge at all.
  bool get hasBadge => official || verified || premium;

  Color get color => _hexColor(avatarColor);

  /// The colour used to theme this user's profile — their chosen accent, or the
  /// auto-assigned avatar colour as a fallback.
  Color get accent => _hexColor(accentColor ?? avatarColor, fallback: color);

  /// Whether a (still-valid) temporary mood/status is set.
  bool get hasMood =>
      (moodEmoji.isNotEmpty || moodText.isNotEmpty) &&
      (moodUntil == null || moodUntil! > DateTime.now().millisecondsSinceEpoch);

  /// One-line mood string for compact display, e.g. "🎧 fokussiert".
  String get moodLine =>
      [moodEmoji, moodText].where((s) => s.isNotEmpty).join(' ').trim();

  /// Whether the profile carries any extra info worth showing a section for.
  bool get hasProfileExtras =>
      about.trim().isNotEmpty ||
      pronouns.trim().isNotEmpty ||
      city.trim().isNotEmpty ||
      birthday.trim().isNotEmpty ||
      links.isNotEmpty;

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
    String? accentColor,
    bool? hasBanner,
    int? bannerVersion,
    String? pronouns,
    String? birthday,
    String? city,
    List<ProfileLink>? links,
    String? moodEmoji,
    String? moodText,
    int? moodUntil,
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
        accentColor: accentColor ?? this.accentColor,
        hasBanner: hasBanner ?? this.hasBanner,
        bannerVersion: bannerVersion ?? this.bannerVersion,
        pronouns: pronouns ?? this.pronouns,
        birthday: birthday ?? this.birthday,
        city: city ?? this.city,
        links: links ?? this.links,
        moodEmoji: moodEmoji ?? this.moodEmoji,
        moodText: moodText ?? this.moodText,
        moodUntil: moodUntil ?? this.moodUntil,
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
        if (accentColor != null) 'accentColor': accentColor,
        'hasBanner': hasBanner,
        'bannerVersion': bannerVersion,
        'pronouns': pronouns,
        'birthday': birthday,
        'city': city,
        'links': links.map((l) => l.toJson()).toList(),
        'moodEmoji': moodEmoji,
        'moodText': moodText,
        if (moodUntil != null) 'moodUntil': moodUntil,
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
        accentColor: json['accentColor'] as String?,
        hasBanner: (json['hasBanner'] ?? false) as bool,
        bannerVersion: (json['bannerVersion'] ?? 0) as int,
        pronouns: (json['pronouns'] ?? '') as String,
        birthday: (json['birthday'] ?? '') as String,
        city: (json['city'] ?? '') as String,
        links: (json['links'] as List?)
                ?.whereType<Map>()
                .map((e) => ProfileLink.fromJson(e.cast<String, dynamic>()))
                .where((l) => l.url.isNotEmpty)
                .toList() ??
            const [],
        moodEmoji: (json['moodEmoji'] ?? '') as String,
        moodText: (json['moodText'] ?? '') as String,
        moodUntil: json['moodUntil'] as int?,
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
