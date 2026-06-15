import 'package:flutter_test/flutter_test.dart';
import 'package:ping/models/chat.dart';
import 'package:ping/models/settings.dart';
import 'package:ping/services/app_lock_service.dart';
import 'package:ping/utils/chat_filter.dart';
import 'package:ping/utils/chat_sort.dart';
import 'package:ping/utils/emoji.dart';
import 'package:ping/utils/format.dart';

Chat _chat(
  String id, {
  String type = 'direct',
  int unread = 0,
  int updatedAt = 0,
  bool self = false,
  String? title,
}) =>
    Chat(
      id: id,
      type: type,
      title: title ?? 'Chat $id',
      avatarColor: '#42A5F5',
      memberIds: const [],
      updatedAt: updatedAt,
      unread: unread,
      self: self,
    );

void main() {
  group('PingSettings new fields', () {
    test('defaults are sensible', () {
      const s = PingSettings();
      expect(s.clock24h, true);
      expect(s.compactChats, false);
      expect(s.bigEmoji, true);
      expect(s.hideListPreview, false);
      expect(s.inAppSounds, true);
      expect(s.hapticFeedback, true);
      expect(s.appLockEnabled, false);
      expect(s.appLockPinHash, '');
      expect(s.appLockGraceSeconds, 0);
      // New in this release.
      expect(s.chatSort, 'recent');
      expect(s.accentBubbles, false);
      expect(s.messageFormatting, true);
      expect(s.wallpaperDim, 0.0);
      expect(s.swipeRightAction, 'pin');
      expect(s.startTab, 0);
      expect(s.incognitoKeyboard, false);
      expect(s.confirmBeforeDelete, true);
      expect(s.quickReplies, isNotEmpty);
    });

    test('round-trips through encode/decode', () {
      const s = PingSettings(
        clock24h: false,
        compactChats: true,
        bigEmoji: false,
        hideListPreview: true,
        inAppSounds: false,
        hapticFeedback: false,
        appLockEnabled: true,
        appLockPinHash: 'abc123',
        appLockGraceSeconds: 60,
        chatSort: 'unread',
        accentBubbles: true,
        messageFormatting: false,
        wallpaperDim: 0.4,
        swipeRightAction: 'mute',
        startTab: 2,
        incognitoKeyboard: true,
        confirmBeforeDelete: false,
        quickReplies: ['Hi', 'Bye'],
      );
      final back = PingSettings.decode(s.encode());
      expect(back.clock24h, false);
      expect(back.compactChats, true);
      expect(back.bigEmoji, false);
      expect(back.hideListPreview, true);
      expect(back.inAppSounds, false);
      expect(back.hapticFeedback, false);
      expect(back.appLockEnabled, true);
      expect(back.appLockPinHash, 'abc123');
      expect(back.appLockGraceSeconds, 60);
      expect(back.chatSort, 'unread');
      expect(back.accentBubbles, true);
      expect(back.messageFormatting, false);
      expect(back.wallpaperDim, 0.4);
      expect(back.swipeRightAction, 'mute');
      expect(back.startTab, 2);
      expect(back.incognitoKeyboard, true);
      expect(back.confirmBeforeDelete, false);
      expect(back.quickReplies, ['Hi', 'Bye']);
    });

    test('older settings JSON (missing new keys) falls back to defaults', () {
      // Simulate a blob written by an older build with none of the new fields.
      final back = PingSettings.decode('{"readReceipts":false}');
      expect(back.readReceipts, false);
      expect(back.clock24h, true);
      expect(back.bigEmoji, true);
      expect(back.inAppSounds, true);
      expect(back.appLockEnabled, false);
      // New keys absent → defaults.
      expect(back.chatSort, 'recent');
      expect(back.messageFormatting, true);
      expect(back.confirmBeforeDelete, true);
      expect(back.quickReplies, kDefaultQuickReplies);
    });

    test('out-of-range numeric prefs are clamped on decode', () {
      final back = PingSettings.decode(
          '{"wallpaperDim":2.0,"startTab":9}');
      expect(back.wallpaperDim, 0.6); // clamped to max
      expect(back.startTab, 2); // clamped to last tab
    });

    test('blank quick replies are dropped on decode', () {
      final back = PingSettings.decode('{"quickReplies":["ok","  ",""]}');
      expect(back.quickReplies, ['ok']);
    });
  });

  group('ChatSort', () {
    bool noPins(String _) => false;

    test('id <-> label round-trips through fromId', () {
      for (final m in ChatSort.values) {
        expect(ChatSortId.fromId(m.id), m);
        expect(m.label, isNotEmpty);
      }
      expect(ChatSortId.fromId('bogus'), ChatSort.recent);
      expect(ChatSortId.fromId(null), ChatSort.recent);
    });

    test('recent orders by activity, newest first', () {
      final chats = [
        _chat('a', updatedAt: 10),
        _chat('b', updatedAt: 30),
        _chat('c', updatedAt: 20),
      ];
      final r = sortedChats(chats, ChatSort.recent, isPinned: noPins);
      expect(r.map((c) => c.id), ['b', 'c', 'a']);
    });

    test('unread floats unread chats to the top', () {
      final chats = [
        _chat('a', updatedAt: 30),
        _chat('b', updatedAt: 10, unread: 2),
        _chat('c', updatedAt: 20),
      ];
      final r = sortedChats(chats, ChatSort.unread, isPinned: noPins);
      expect(r.first.id, 'b');
    });

    test('alphabetical sorts by display title, case-insensitively', () {
      final chats = [
        _chat('1', title: 'Zoe'),
        _chat('2', title: 'anna'),
        _chat('3', title: 'Max'),
      ];
      final r = sortedChats(chats, ChatSort.alphabetical, isPinned: noPins);
      expect(r.map((c) => c.title), ['anna', 'Max', 'Zoe']);
    });

    test('note-to-self and pinned chats always come first', () {
      final chats = [
        _chat('a', updatedAt: 30),
        _chat('self', updatedAt: 1, self: true),
        _chat('pin', updatedAt: 5),
      ];
      bool pinned(String id) => id == 'pin';
      final r = sortedChats(chats, ChatSort.recent, isPinned: pinned);
      expect(r.map((c) => c.id), ['self', 'pin', 'a']);
    });
  });

  group('AppLock', () {
    test('hashing is deterministic and verifies', () {
      final h = AppLock.hashPin('1234');
      expect(AppLock.hashPin('1234'), h);
      expect(AppLock.verify('1234', h), true);
      expect(AppLock.verify('4321', h), false);
      expect(AppLock.verify('', h), false);
      expect(AppLock.verify('1234', ''), false);
    });

    test('validates PIN shape', () {
      expect(AppLock.isValidPin('1234'), true);
      expect(AppLock.isValidPin('12345678'), true);
      expect(AppLock.isValidPin('123'), false); // too short
      expect(AppLock.isValidPin('123456789'), false); // too long
      expect(AppLock.isValidPin('12a4'), false); // non-digit
    });

    test('grace labels', () {
      expect(AppLock.graceLabel(0), 'Sofort');
      expect(AppLock.graceLabel(60), 'Nach 1 Minute');
      expect(AppLock.graceLabel(120), 'Nach 2 Minuten');
      expect(AppLock.graceLabel(45), 'Nach 45 Sekunden');
    });

    test('shouldLock honours enabled, pin and grace', () {
      bool lock(int grace, Duration bg) => AppLock.shouldLock(
            enabled: true,
            pinHash: 'x',
            graceSeconds: grace,
            backgrounded: bg,
          );
      expect(lock(0, Duration.zero), true);
      expect(lock(60, const Duration(seconds: 30)), false);
      expect(lock(60, const Duration(seconds: 90)), true);
      // Disabled or no PIN never locks.
      expect(
          AppLock.shouldLock(
              enabled: false,
              pinHash: 'x',
              graceSeconds: 0,
              backgrounded: const Duration(hours: 1)),
          false);
      expect(
          AppLock.shouldLock(
              enabled: true,
              pinHash: '',
              graceSeconds: 0,
              backgrounded: const Duration(hours: 1)),
          false);
    });
  });

  group('ChatFilter', () {
    final all = [
      _chat('a', unread: 3),
      _chat('b'),
      _chat('g', type: 'group', unread: 1),
    ];
    bool fav(String id) => id == 'b';

    test('all keeps everything', () {
      expect(applyChatFilter(all, ChatFilter.all, isFavorite: fav).length, 3);
    });
    test('unread keeps only unread chats', () {
      final r = applyChatFilter(all, ChatFilter.unread, isFavorite: fav);
      expect(r.map((c) => c.id), ['a', 'g']);
    });
    test('favorites uses the supplied predicate', () {
      final r = applyChatFilter(all, ChatFilter.favorites, isFavorite: fav);
      expect(r.map((c) => c.id), ['b']);
    });
    test('groups keeps only groups', () {
      final r = applyChatFilter(all, ChatFilter.groups, isFavorite: fav);
      expect(r.map((c) => c.id), ['g']);
    });
    test('labels are set', () {
      expect(ChatFilter.unread.label, 'Ungelesen');
      expect(ChatFilter.favorites.label, 'Favoriten');
    });
  });

  group('EmojiText', () {
    test('detects emoji-only messages', () {
      expect(EmojiText.isEmojiOnly('😀'), true);
      expect(EmojiText.isEmojiOnly('😀 🎉 🚀'), true);
      expect(EmojiText.isEmojiOnly('👨‍👩‍👧'), true); // ZWJ family
      expect(EmojiText.isEmojiOnly('⭐'), true);
    });
    test('rejects text and mixed content', () {
      expect(EmojiText.isEmojiOnly('hi 😀'), false);
      expect(EmojiText.isEmojiOnly('hello'), false);
      expect(EmojiText.isEmojiOnly(''), false);
      expect(EmojiText.isEmojiOnly('   '), false);
      expect(EmojiText.isEmojiOnly('123'), false);
    });
    test('scales down as the count grows', () {
      final one = EmojiText.scaleFor('😀');
      final two = EmojiText.scaleFor('😀😀');
      expect(one, greaterThan(two));
      expect(EmojiText.scaleFor('hello'), 1.0);
    });
  });

  group('TimeFormat clock mode', () {
    test('24h vs 12h rendering', () {
      final t = DateTime(2026, 1, 1, 14, 30);
      TimeFormat.clock24h = true;
      expect(TimeFormat.messageTime(t), '14:30');
      TimeFormat.clock24h = false;
      final twelve = TimeFormat.messageTime(t);
      expect(twelve.toUpperCase().contains('PM'), true);
      expect(twelve.contains('2:30'), true);
      TimeFormat.clock24h = true; // restore for other tests
    });
  });
}
