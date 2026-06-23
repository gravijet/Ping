import 'user.dart';

/// Delivery state of a message the current user sent.
enum MessageStatus { sending, sent, delivered, read, failed }

/// One recipient's delivery/read state for a message — used by the "message
/// info" sheet (long-press → Info).
class MessageReceiptInfo {
  final PingUser user;
  final int? deliveredAt;
  final int? readAt;

  const MessageReceiptInfo({required this.user, this.deliveredAt, this.readAt});

  bool get read => readAt != null;
  bool get delivered => deliveredAt != null;

  factory MessageReceiptInfo.fromJson(Map<String, dynamic> json) =>
      MessageReceiptInfo(
        user: PingUser.fromJson(json['user'] as Map<String, dynamic>),
        deliveredAt: json['deliveredAt'] as int?,
        readAt: json['readAt'] as int?,
      );
}

MessageStatus statusFromString(String? s) {
  switch (s) {
    case 'sent':
      return MessageStatus.sent;
    case 'delivered':
      return MessageStatus.delivered;
    case 'read':
      return MessageStatus.read;
    default:
      return MessageStatus.sent;
  }
}

/// One answer option of a poll, with its current vote count.
class PollOption {
  final String text;
  final int votes;
  const PollOption({required this.text, required this.votes});

  factory PollOption.fromJson(Map<String, dynamic> json) => PollOption(
        text: (json['text'] ?? '') as String,
        votes: (json['votes'] ?? 0) as int,
      );

  Map<String, dynamic> toJson() => {'text': text, 'votes': votes};
}

/// The poll payload riding along on a message of type 'poll'.
class PollData {
  final String question;
  final bool multi;
  final List<PollOption> options;
  final List<int> myVotes;
  final int totalVoters;

  const PollData({
    required this.question,
    required this.multi,
    required this.options,
    required this.myVotes,
    required this.totalVoters,
  });

  int get totalVotes => options.fold(0, (sum, o) => sum + o.votes);

  factory PollData.fromJson(Map<String, dynamic> json) => PollData(
        question: (json['question'] ?? '') as String,
        multi: (json['multi'] ?? false) as bool,
        options: ((json['options'] as List?) ?? const [])
            .map((e) => PollOption.fromJson(e as Map<String, dynamic>))
            .toList(),
        myVotes: ((json['myVotes'] as List?) ?? const [])
            .map((e) => (e as num).toInt())
            .toList(),
        totalVoters: (json['totalVoters'] ?? 0) as int,
      );

  Map<String, dynamic> toJson() => {
        'question': question,
        'multi': multi,
        'options': options.map((o) => o.toJson()).toList(),
        'myVotes': myVotes,
        'totalVoters': totalVoters,
      };
}

// ── „Alles" (0.34.0) structured-message payloads ───────────────────────────

/// One attendee of an event (RSVP roster row).
class EventAttendee {
  final String userId;
  final String status; // going | maybe | declined
  final String displayName;
  const EventAttendee(
      {required this.userId, required this.status, required this.displayName});
  factory EventAttendee.fromJson(Map<String, dynamic> j) => EventAttendee(
        userId: (j['userId'] ?? '') as String,
        status: (j['status'] ?? '') as String,
        displayName: (j['displayName'] ?? '') as String,
      );
  Map<String, dynamic> toJson() =>
      {'userId': userId, 'status': status, 'displayName': displayName};
}

/// Event ("Termin") payload on a message of type 'event'.
class EventData {
  final String id;
  final String title;
  final String description;
  final String location;
  final int startAt;
  final String? myStatus; // going | maybe | declined | null
  final Map<String, int> counts; // going/maybe/declined → n
  final List<EventAttendee> attendees;

  const EventData({
    required this.id,
    required this.title,
    required this.startAt,
    this.description = '',
    this.location = '',
    this.myStatus,
    this.counts = const {},
    this.attendees = const [],
  });

  factory EventData.fromJson(Map<String, dynamic> j) => EventData(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? 'Termin') as String,
        description: (j['description'] ?? '') as String,
        location: (j['location'] ?? '') as String,
        startAt: (j['startAt'] as num?)?.toInt() ?? 0,
        myStatus: j['myStatus'] as String?,
        counts: (j['counts'] as Map?)?.map(
                (k, v) => MapEntry(k as String, (v as num).toInt())) ??
            const {},
        attendees: ((j['attendees'] as List?) ?? const [])
            .map((e) => EventAttendee.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'location': location,
        'startAt': startAt,
        if (myStatus != null) 'myStatus': myStatus,
        'counts': counts,
        'attendees': attendees.map((a) => a.toJson()).toList(),
      };
}

/// One checklist item of a task list.
class TaskItem {
  final String id;
  final String text;
  final bool done;
  final String doneByName;
  const TaskItem(
      {required this.id,
      required this.text,
      required this.done,
      this.doneByName = ''});
  factory TaskItem.fromJson(Map<String, dynamic> j) => TaskItem(
        id: (j['id'] ?? '') as String,
        text: (j['text'] ?? '') as String,
        done: (j['done'] ?? false) as bool,
        doneByName: (j['doneByName'] ?? '') as String,
      );
  Map<String, dynamic> toJson() =>
      {'id': id, 'text': text, 'done': done, 'doneByName': doneByName};
}

/// Task-list ("Aufgaben") payload on a message of type 'tasklist'.
class TaskListData {
  final String id;
  final String title;
  final List<TaskItem> items;
  final int total;
  final int completed;
  const TaskListData({
    required this.id,
    required this.title,
    required this.items,
    required this.total,
    required this.completed,
  });
  factory TaskListData.fromJson(Map<String, dynamic> j) => TaskListData(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? 'Aufgaben') as String,
        items: ((j['items'] as List?) ?? const [])
            .map((e) => TaskItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: (j['total'] as num?)?.toInt() ?? 0,
        completed: (j['completed'] as num?)?.toInt() ?? 0,
      );
  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'items': items.map((i) => i.toJson()).toList(),
        'total': total,
        'completed': completed,
      };
}

/// One kanban card.
class BoardCard {
  final String id;
  final String text;
  const BoardCard({required this.id, required this.text});
  factory BoardCard.fromJson(Map<String, dynamic> j) =>
      BoardCard(id: (j['id'] ?? '') as String, text: (j['text'] ?? '') as String);
  Map<String, dynamic> toJson() => {'id': id, 'text': text};
}

/// One kanban column with its cards.
class BoardColumn {
  final String id;
  final String title;
  final List<BoardCard> cards;
  const BoardColumn(
      {required this.id, required this.title, this.cards = const []});
  factory BoardColumn.fromJson(Map<String, dynamic> j) => BoardColumn(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? '') as String,
        cards: ((j['cards'] as List?) ?? const [])
            .map((e) => BoardCard.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
  Map<String, dynamic> toJson() =>
      {'id': id, 'title': title, 'cards': cards.map((c) => c.toJson()).toList()};
}

/// Kanban-board payload on a message of type 'board'.
class BoardData {
  final String id;
  final String title;
  final List<BoardColumn> columns;
  const BoardData(
      {required this.id, required this.title, this.columns = const []});
  factory BoardData.fromJson(Map<String, dynamic> j) => BoardData(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? 'Board') as String,
        columns: ((j['columns'] as List?) ?? const [])
            .map((e) => BoardColumn.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'columns': columns.map((c) => c.toJson()).toList(),
      };
}

/// Mini-game payload on a message of type 'game'.
class GameData {
  final String kind; // tictactoe | connect4
  final List<int?> cells;
  final List<String> players;
  final String? turn;
  final String? winner; // a userId, 'draw', or null
  const GameData({
    required this.kind,
    required this.cells,
    required this.players,
    this.turn,
    this.winner,
  });
  factory GameData.fromJson(Map<String, dynamic> j) => GameData(
        kind: (j['kind'] ?? 'tictactoe') as String,
        cells: ((j['cells'] as List?) ?? const [])
            .map((e) => e == null ? null : (e as num).toInt())
            .toList(),
        players: ((j['players'] as List?) ?? const []).cast<String>(),
        turn: j['turn'] as String?,
        winner: j['winner'] as String?,
      );
  Map<String, dynamic> toJson() => {
        'kind': kind,
        'cells': cells,
        'players': players,
        if (turn != null) 'turn': turn,
        if (winner != null) 'winner': winner,
      };
}

/// Live-location payload on a message of type 'livelocation'.
class LiveLocationData {
  final bool active;
  final double? lat;
  final double? lng;
  final int? updatedAt;
  final int? expiresAt;
  const LiveLocationData(
      {required this.active, this.lat, this.lng, this.updatedAt, this.expiresAt});
  factory LiveLocationData.fromJson(Map<String, dynamic> j) => LiveLocationData(
        active: (j['active'] ?? false) as bool,
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        updatedAt: (j['updatedAt'] as num?)?.toInt(),
        expiresAt: (j['expiresAt'] as num?)?.toInt(),
      );
  Map<String, dynamic> toJson() => {
        'active': active,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        if (updatedAt != null) 'updatedAt': updatedAt,
        if (expiresAt != null) 'expiresAt': expiresAt,
      };
}

/// On-prem voice transcript payload (rides along on a 'voice' message).
class TranscriptData {
  final String status; // queued | running | done | failed
  final String text;
  const TranscriptData({required this.status, this.text = ''});
  factory TranscriptData.fromJson(Map<String, dynamic> j) => TranscriptData(
        status: (j['status'] ?? '') as String,
        text: (j['text'] ?? '') as String,
      );
  Map<String, dynamic> toJson() => {'status': status, 'text': text};
}

/// 0.35.0 "Ausdruck & Werkbank": a shared contact card (rides on a 'contact'
/// message). When [isUser] the card links a live account ([userId]); tapping it
/// opens a chat. The other fields are a snapshot taken at share time.
class ContactData {
  final String? userId;
  final bool isUser;
  final String displayName;
  final String? username;
  final String avatarColor;
  final bool hasAvatar;
  final int avatarVersion;
  final String note;
  const ContactData({
    this.userId,
    this.isUser = false,
    required this.displayName,
    this.username,
    this.avatarColor = '#888888',
    this.hasAvatar = false,
    this.avatarVersion = 0,
    this.note = '',
  });
  factory ContactData.fromJson(Map<String, dynamic> j) => ContactData(
        userId: j['userId'] as String?,
        isUser: (j['isUser'] ?? false) as bool,
        displayName: (j['displayName'] ?? 'Kontakt') as String,
        username: j['username'] as String?,
        avatarColor: (j['avatarColor'] ?? '#888888') as String,
        hasAvatar: (j['hasAvatar'] ?? false) as bool,
        avatarVersion: (j['avatarVersion'] as num?)?.toInt() ?? 0,
        note: (j['note'] ?? '') as String,
      );
  Map<String, dynamic> toJson() => {
        if (userId != null) 'userId': userId,
        'isUser': isUser,
        'displayName': displayName,
        if (username != null) 'username': username,
        'avatarColor': avatarColor,
        'hasAvatar': hasAvatar,
        'avatarVersion': avatarVersion,
        'note': note,
      };
}

/// 0.35.0: a shared code snippet (rides on a 'code' message). The full source
/// lives here; the message body is only a short teaser.
class CodeData {
  final String language;
  final String filename;
  final String code;
  final int lines;
  const CodeData({
    this.language = '',
    this.filename = '',
    required this.code,
    this.lines = 0,
  });
  factory CodeData.fromJson(Map<String, dynamic> j) => CodeData(
        language: (j['language'] ?? '') as String,
        filename: (j['filename'] ?? '') as String,
        code: (j['code'] ?? '') as String,
        lines: (j['lines'] as num?)?.toInt() ??
            ((j['code'] ?? '') as String).split('\n').length,
      );
  Map<String, dynamic> toJson() => {
        'language': language,
        'filename': filename,
        'code': code,
        'lines': lines,
      };
  String get label => filename.isNotEmpty
      ? filename
      : (language.isNotEmpty ? language : 'Code');
}

/// 0.36.0: one participant's share of a shared expense.
class ExpenseShare {
  final String userId;
  final String name;
  final int shareCents;
  const ExpenseShare(
      {required this.userId, required this.name, required this.shareCents});
  factory ExpenseShare.fromJson(Map<String, dynamic> j) => ExpenseShare(
        userId: (j['userId'] ?? '') as String,
        name: (j['name'] ?? '') as String,
        shareCents: (j['shareCents'] as num?)?.toInt() ?? 0,
      );
  Map<String, dynamic> toJson() =>
      {'userId': userId, 'name': name, 'shareCents': shareCents};
}

/// 0.36.0: shared-expense ("Geteilte Kasse") payload on an 'expense' message.
/// A `kind` of 'settlement' means one member paid another to clear a debt.
class ExpenseData {
  final String id;
  final String title;
  final int amountCents;
  final String currency;
  final String kind; // expense | settlement
  final String payerId;
  final String payerName;
  final List<ExpenseShare> shares;
  final int myShare;
  final bool iPaid;
  const ExpenseData({
    required this.id,
    required this.title,
    required this.amountCents,
    this.currency = 'EUR',
    this.kind = 'expense',
    required this.payerId,
    this.payerName = '',
    this.shares = const [],
    this.myShare = 0,
    this.iPaid = false,
  });
  factory ExpenseData.fromJson(Map<String, dynamic> j) => ExpenseData(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? 'Ausgabe') as String,
        amountCents: (j['amountCents'] as num?)?.toInt() ?? 0,
        currency: (j['currency'] ?? 'EUR') as String,
        kind: (j['kind'] ?? 'expense') as String,
        payerId: (j['payerId'] ?? '') as String,
        payerName: (j['payerName'] ?? '') as String,
        shares: ((j['shares'] as List?) ?? const [])
            .map((e) => ExpenseShare.fromJson(e as Map<String, dynamic>))
            .toList(),
        myShare: (j['myShare'] as num?)?.toInt() ?? 0,
        iPaid: (j['iPaid'] ?? false) as bool,
      );
  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'amountCents': amountCents,
        'currency': currency,
        'kind': kind,
        'payerId': payerId,
        'payerName': payerName,
        'shares': shares.map((s) => s.toJson()).toList(),
        'myShare': myShare,
        'iPaid': iPaid,
      };
}

/// 0.36.0: one candidate time slot of an availability poll.
class AvailPollOption {
  final String id;
  final int startAt;
  final Map<String, int> counts; // yes/maybe/no → n
  final String? myVote; // yes | maybe | no | null
  const AvailPollOption({
    required this.id,
    required this.startAt,
    this.counts = const {},
    this.myVote,
  });
  factory AvailPollOption.fromJson(Map<String, dynamic> j) => AvailPollOption(
        id: (j['id'] ?? '') as String,
        startAt: (j['startAt'] as num?)?.toInt() ?? 0,
        counts: (j['counts'] as Map?)?.map(
                (k, v) => MapEntry(k as String, (v as num).toInt())) ??
            const {},
        myVote: j['myVote'] as String?,
      );
  Map<String, dynamic> toJson() => {
        'id': id,
        'startAt': startAt,
        'counts': counts,
        if (myVote != null) 'myVote': myVote,
      };
}

/// 0.36.0: availability-poll ("Terminfindung") payload on an 'availpoll' message.
class AvailPollData {
  final String id;
  final String title;
  final String location;
  final bool closed;
  final String? chosenOptionId;
  final String? bestOptionId;
  final String creatorId;
  final List<AvailPollOption> options;
  const AvailPollData({
    required this.id,
    required this.title,
    this.location = '',
    this.closed = false,
    this.chosenOptionId,
    this.bestOptionId,
    required this.creatorId,
    this.options = const [],
  });
  factory AvailPollData.fromJson(Map<String, dynamic> j) => AvailPollData(
        id: (j['id'] ?? '') as String,
        title: (j['title'] ?? 'Terminfindung') as String,
        location: (j['location'] ?? '') as String,
        closed: (j['closed'] ?? false) as bool,
        chosenOptionId: j['chosenOptionId'] as String?,
        bestOptionId: j['bestOptionId'] as String?,
        creatorId: (j['creatorId'] ?? '') as String,
        options: ((j['options'] as List?) ?? const [])
            .map((e) => AvailPollOption.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'location': location,
        'closed': closed,
        if (chosenOptionId != null) 'chosenOptionId': chosenOptionId,
        if (bestOptionId != null) 'bestOptionId': bestOptionId,
        'creatorId': creatorId,
        'options': options.map((o) => o.toJson()).toList(),
      };
}

/// A media attachment carried by a message (or a status). The [url] is always a
/// server-relative path like `/api/uploads/<id>`; the app prefixes the base URL.
class Attachment {
  final String kind; // image | gif | video | audio | voice | file
  final String url;
  final String? mime;
  final String? name;
  final int? size;
  final int? width;
  final int? height;
  final int? durationMs;

  const Attachment({
    required this.kind,
    required this.url,
    this.mime,
    this.name,
    this.size,
    this.width,
    this.height,
    this.durationMs,
  });

  bool get isImage => kind == 'image' || kind == 'gif';
  bool get isVisual => kind == 'image' || kind == 'gif' || kind == 'video';
  bool get isAudio => kind == 'audio' || kind == 'voice';
  bool get isVoice => kind == 'voice';

  factory Attachment.fromJson(Map<String, dynamic> json) => Attachment(
        kind: (json['kind'] ?? 'file') as String,
        url: (json['url'] ?? '') as String,
        mime: json['mime'] as String?,
        name: json['name'] as String?,
        size: json['size'] as int?,
        width: json['width'] as int?,
        height: json['height'] as int?,
        durationMs: json['durationMs'] as int?,
      );

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'url': url,
        if (mime != null) 'mime': mime,
        if (name != null) 'name': name,
        if (size != null) 'size': size,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (durationMs != null) 'durationMs': durationMs,
      };
}

class Message {
  final String id;
  final String chatId;
  final String? senderId;
  final String type; // text | system | image | gif | video | audio | voice | file
  final String body;
  final Attachment? attachment;
  final String? replyTo;
  final int createdAt;
  final int? editedAt;

  /// How many earlier versions of this message exist (0.28.0 "Kontext"). Drives
  /// the tappable "bearbeitet"-history viewer; 0 when never edited.
  final int editCount;
  final bool deleted;

  /// Disappearing messages: when set, the server purges this message at that
  /// time and the client should stop showing it.
  final int? expiresAt;

  /// Poll payload for messages of type 'poll' (question, options, votes).
  final PollData? poll;

  // ── „Alles" (0.34.0) structured payloads (each null unless the type matches).
  final EventData? event;
  final TaskListData? tasklist;
  final BoardData? board;
  final GameData? game;
  final LiveLocationData? liveLocation;

  /// On-prem transcript that rides along on a 'voice' message (may be pending).
  final TranscriptData? transcript;

  // ── „Ausdruck & Werkbank" (0.35.0) payloads (null unless the type matches).
  final ContactData? contact;
  final CodeData? code;

  // ── „Zusammen" (0.36.0) payloads (null unless the type matches).
  final ExpenseData? expense;
  final AvailPollData? availpoll;

  /// How many replies hang off this message in its thread (0 = none).
  final int threadCount;

  /// View-once media: [viewOnce] marks it; [viewed] is true once it's been
  /// opened (after which the bytes are withheld for everyone).
  final bool viewOnce;
  final bool viewed;

  /// End-to-end encrypted body (opaque ciphertext). The app shows a neutral
  /// marker — on-device decryption is web/desktop-first.
  final bool enc;
  MessageStatus? status; // only meaningful for messages I sent

  /// Emoji reactions on this message: emoji → count, plus the set of emojis the
  /// current user reacted with (for highlighting their own picks).
  final Map<String, int> reactions;
  final Set<String> myReactions;

  /// 0.27.0 "Ordnung & Ausdruck": chat-wide pin state and this user's personal
  /// bookmark ("Markiert"). Both ride along on every message view + update.
  final bool pinned;
  final bool starred;

  /// A lightweight snapshot of the message this one replies to, supplied by the
  /// server so the quote always renders — even when the original is outside the
  /// loaded window. Null when this isn't a reply.
  final Message? quoted;

  Message({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.body,
    required this.createdAt,
    this.attachment,
    this.replyTo,
    this.editedAt,
    this.editCount = 0,
    this.deleted = false,
    this.expiresAt,
    this.poll,
    this.event,
    this.tasklist,
    this.board,
    this.game,
    this.liveLocation,
    this.transcript,
    this.contact,
    this.code,
    this.expense,
    this.availpoll,
    this.threadCount = 0,
    this.viewOnce = false,
    this.viewed = false,
    this.enc = false,
    this.status,
    this.quoted,
    this.reactions = const {},
    this.myReactions = const {},
    this.pinned = false,
    this.starred = false,
  });

  /// True when the disappearing-messages timer of this message has run out
  /// (the server purge may lag by up to a minute; the client hides it sooner).
  bool get isExpired =>
      expiresAt != null && expiresAt! <= DateTime.now().millisecondsSinceEpoch;

  bool get hasReactions => reactions.isNotEmpty;
  bool get isSystem => type == 'system';
  bool get isEdited => editedAt != null && !deleted;
  bool get isMedia => type != 'text' && type != 'system';

  /// True when the message body is just a handful of emoji (no letters/digits).
  /// Such messages are rendered "jumbo" without a bubble, like WhatsApp — which
  /// is also how the built-in emoji stickers are sent.
  bool get isEmojiOnly {
    if (type != 'text' || deleted) return false;
    final t = body.trim();
    if (t.isEmpty) return false;
    var graphemes = 0;
    var sawPictograph = false;
    for (final rune in t.runes) {
      if (rune == 0x20 || rune == 0x200d || rune == 0xfe0f || rune == 0xfe0e) {
        continue; // spaces, ZWJ and variation selectors don't count
      }
      // Any printable ASCII (letters, digits, punctuation) disqualifies it.
      if (rune >= 0x21 && rune <= 0x7e) return false;
      if (rune > 0x2000) sawPictograph = true;
      graphemes++;
    }
    return sawPictograph && graphemes <= 8;
  }

  DateTime get time => DateTime.fromMillisecondsSinceEpoch(createdAt);

  /// A short label for the chat list / reply preview when there's no text.
  String get preview {
    if (deleted) return 'Diese Nachricht wurde gelöscht';
    if (body.trim().isNotEmpty) return body;
    switch (type) {
      case 'image':
        return '📷 Foto';
      case 'gif':
        return 'GIF';
      case 'video':
        return '🎬 Video';
      case 'voice':
        return '🎤 Sprachnachricht';
      case 'audio':
        return '🎵 Audio';
      case 'file':
        return '📎 ${attachment?.name ?? 'Datei'}';
      case 'poll':
        return '📊 ${poll?.question ?? 'Umfrage'}';
      case 'event':
        return '📅 Termin';
      case 'tasklist':
        return '✅ Aufgabenliste';
      case 'sticker':
        return '🎉 Sticker';
      case 'board':
        return '📋 Board';
      case 'game':
        return '🎮 Spiel';
      case 'livelocation':
        return '📍 Live-Standort';
      case 'contact':
        return '👤 ${contact?.displayName ?? 'Kontakt'}';
      case 'code':
        return '‹/› ${code?.label ?? 'Code-Snippet'}';
      case 'expense':
        return '💶 Ausgabe';
      case 'availpoll':
        return '🗓️ Terminfindung';
      // 0.38.0 "Universum": the new structured/media types.
      case 'whiteboard':
        return '🎨 Whiteboard';
      case 'doc':
        return '📄 Dokument';
      case 'playlist':
        return '🎵 Playlist';
      case 'recipe':
        return '🍳 Rezept';
      case 'flashcards':
        return '🃏 Lernkarten';
      case 'form':
        return '📝 Formular';
      case 'bookmark':
        return '🔖 Lesezeichen';
      case 'place':
        return '🗺️ Orte';
      case 'videonote':
        return '⭕ Videonotiz';
      case 'watchparty':
        return '🍿 Kinoabend';
      case 'gift':
        return '🎁 Geschenk';
      default:
        return body;
    }
  }

  Message copyWith({
    String? body,
    int? editedAt,
    int? editCount,
    bool? deleted,
    MessageStatus? status,
    Map<String, int>? reactions,
    Set<String>? myReactions,
    PollData? poll,
    EventData? event,
    TaskListData? tasklist,
    BoardData? board,
    GameData? game,
    LiveLocationData? liveLocation,
    TranscriptData? transcript,
    ContactData? contact,
    CodeData? code,
    ExpenseData? expense,
    AvailPollData? availpoll,
    int? threadCount,
    bool? viewed,
    bool? pinned,
    bool? starred,
  }) =>
      Message(
        id: id,
        chatId: chatId,
        senderId: senderId,
        type: type,
        body: body ?? this.body,
        attachment: attachment,
        replyTo: replyTo,
        createdAt: createdAt,
        editedAt: editedAt ?? this.editedAt,
        editCount: editCount ?? this.editCount,
        deleted: deleted ?? this.deleted,
        expiresAt: expiresAt,
        poll: poll ?? this.poll,
        event: event ?? this.event,
        tasklist: tasklist ?? this.tasklist,
        board: board ?? this.board,
        game: game ?? this.game,
        liveLocation: liveLocation ?? this.liveLocation,
        transcript: transcript ?? this.transcript,
        contact: contact ?? this.contact,
        code: code ?? this.code,
        expense: expense ?? this.expense,
        availpoll: availpoll ?? this.availpoll,
        threadCount: threadCount ?? this.threadCount,
        viewOnce: viewOnce,
        viewed: viewed ?? this.viewed,
        enc: enc,
        status: status ?? this.status,
        quoted: quoted,
        reactions: reactions ?? this.reactions,
        myReactions: myReactions ?? this.myReactions,
        pinned: pinned ?? this.pinned,
        starred: starred ?? this.starred,
      );

  /// Serialise for the on-device cache (round-trips through [Message.fromJson]).
  Map<String, dynamic> toJson() => {
        'id': id,
        'chatId': chatId,
        'senderId': senderId,
        'type': type,
        'body': body,
        if (attachment != null) 'attachment': attachment!.toJson(),
        if (replyTo != null) 'replyTo': replyTo,
        'createdAt': createdAt,
        if (editedAt != null) 'editedAt': editedAt,
        if (editCount > 0) 'editCount': editCount,
        if (expiresAt != null) 'expiresAt': expiresAt,
        if (poll != null) 'poll': poll!.toJson(),
        if (event != null) 'event': event!.toJson(),
        if (tasklist != null) 'tasklist': tasklist!.toJson(),
        if (board != null) 'board': board!.toJson(),
        if (game != null) 'game': game!.toJson(),
        if (liveLocation != null) 'liveLocation': liveLocation!.toJson(),
        if (transcript != null) 'transcript': transcript!.toJson(),
        if (contact != null) 'contact': contact!.toJson(),
        if (code != null) 'code': code!.toJson(),
        if (expense != null) 'expense': expense!.toJson(),
        if (availpoll != null) 'availpoll': availpoll!.toJson(),
        if (threadCount > 0) 'threadCount': threadCount,
        if (viewOnce) 'viewOnce': true,
        if (viewed) 'viewed': true,
        if (enc) 'enc': true,
        'deleted': deleted,
        if (status != null && status != MessageStatus.sending &&
            status != MessageStatus.failed)
          'status': status!.name,
        if (reactions.isNotEmpty) 'reactions': reactions,
        if (myReactions.isNotEmpty) 'myReactions': myReactions.toList(),
        if (pinned) 'pinned': true,
        if (starred) 'starred': true,
        if (quoted != null)
          'quoted': {
            'id': quoted!.id,
            'senderId': quoted!.senderId,
            'type': quoted!.type,
            'body': quoted!.body,
            'deleted': quoted!.deleted,
          },
      };

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        chatId: json['chatId'] as String,
        senderId: json['senderId'] as String?,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        attachment: json['attachment'] != null
            ? Attachment.fromJson(json['attachment'] as Map<String, dynamic>)
            : null,
        replyTo: json['replyTo'] as String?,
        createdAt: json['createdAt'] as int,
        editedAt: json['editedAt'] as int?,
        editCount: (json['editCount'] as num?)?.toInt() ?? 0,
        expiresAt: json['expiresAt'] as int?,
        poll: json['poll'] != null
            ? PollData.fromJson(json['poll'] as Map<String, dynamic>)
            : null,
        event: json['event'] != null
            ? EventData.fromJson(json['event'] as Map<String, dynamic>)
            : null,
        tasklist: json['tasklist'] != null
            ? TaskListData.fromJson(json['tasklist'] as Map<String, dynamic>)
            : null,
        board: json['board'] != null
            ? BoardData.fromJson(json['board'] as Map<String, dynamic>)
            : null,
        game: json['game'] != null
            ? GameData.fromJson(json['game'] as Map<String, dynamic>)
            : null,
        liveLocation: json['liveLocation'] != null
            ? LiveLocationData.fromJson(
                json['liveLocation'] as Map<String, dynamic>)
            : null,
        transcript: json['transcript'] != null
            ? TranscriptData.fromJson(json['transcript'] as Map<String, dynamic>)
            : null,
        contact: json['contact'] != null
            ? ContactData.fromJson(json['contact'] as Map<String, dynamic>)
            : null,
        code: json['code'] != null
            ? CodeData.fromJson(json['code'] as Map<String, dynamic>)
            : null,
        expense: json['expense'] != null
            ? ExpenseData.fromJson(json['expense'] as Map<String, dynamic>)
            : null,
        availpoll: json['availpoll'] != null
            ? AvailPollData.fromJson(json['availpoll'] as Map<String, dynamic>)
            : null,
        threadCount: (json['threadCount'] as num?)?.toInt() ?? 0,
        viewOnce: (json['viewOnce'] ?? false) as bool,
        viewed: (json['viewed'] ?? false) as bool,
        enc: (json['enc'] ?? false) as bool,
        deleted: (json['deleted'] ?? false) as bool,
        status: json['status'] != null
            ? statusFromString(json['status'] as String)
            : null,
        reactions: (json['reactions'] as Map?)?.map(
                (k, v) => MapEntry(k as String, (v as num).toInt())) ??
            const {},
        myReactions:
            ((json['myReactions'] as List?)?.cast<String>() ?? const [])
                .toSet(),
        pinned: (json['pinned'] ?? false) as bool,
        starred: (json['starred'] ?? false) as bool,
        quoted: json['quoted'] != null
            ? Message._fromQuoted(
                json['quoted'] as Map<String, dynamic>,
                json['chatId'] as String,
              )
            : null,
      );

  /// Builds a partial message from a server-supplied quoted snapshot. Only the
  /// fields the reply preview needs (sender, type, body, deleted) are populated.
  factory Message._fromQuoted(Map<String, dynamic> json, String chatId) =>
      Message(
        id: json['id'] as String,
        chatId: chatId,
        senderId: json['senderId'] as String?,
        type: (json['type'] ?? 'text') as String,
        body: (json['body'] ?? '') as String,
        createdAt: 0,
        deleted: (json['deleted'] ?? false) as bool,
      );
}
