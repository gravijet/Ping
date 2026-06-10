import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// One row in the message context menu.
class MessageAction {
  final IconData icon;
  final String label;
  final bool destructive;
  final VoidCallback onTap;

  const MessageAction({
    required this.icon,
    required this.label,
    this.destructive = false,
    required this.onTap,
  });
}

/// The quick-reaction emoji shown at the top of the context menu.
const _quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

/// Present the modern "tapback"-style message menu: the rest of the screen is
/// dimmed and blurred, the tapped bubble floats above it, a pill of quick
/// reactions sits over the bubble and a card of actions sits below. This is the
/// single biggest lift away from the default-Android long-press sheet.
Future<void> showMessageActionsMenu(
  BuildContext context, {
  required Widget bubblePreview,
  required bool isMine,
  required Set<String> selectedReactions,
  required void Function(String emoji) onReact,
  required List<MessageAction> actions,
  VoidCallback? onMore,
  Rect? originRect,
}) {
  final screenH = MediaQuery.of(context).size.height;
  final anchorTop =
      originRect != null && originRect.center.dy < screenH * 0.46;

  return showGeneralDialog(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Menü schließen',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (ctx, _, _) => _ActionMenu(
      bubblePreview: bubblePreview,
      isMine: isMine,
      anchorTop: anchorTop,
      selectedReactions: selectedReactions,
      onReact: onReact,
      onMore: onMore,
      actions: actions,
    ),
    transitionBuilder: (ctx, anim, _, child) {
      final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutCubic);
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween(begin: 0.94, end: 1.0).animate(curved),
          alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
          child: child,
        ),
      );
    },
  );
}

class _ActionMenu extends StatelessWidget {
  final Widget bubblePreview;
  final bool isMine;
  final bool anchorTop;
  final Set<String> selectedReactions;
  final void Function(String emoji) onReact;
  final VoidCallback? onMore;
  final List<MessageAction> actions;

  const _ActionMenu({
    required this.bubblePreview,
    required this.isMine,
    required this.anchorTop,
    required this.selectedReactions,
    required this.onReact,
    required this.onMore,
    required this.actions,
  });

  @override
  Widget build(BuildContext context) {
    final align = isMine ? Alignment.centerRight : Alignment.centerLeft;
    return Stack(
      children: [
        // Dimmed + frosted backdrop. Tapping anywhere closes the menu.
        Positioned.fill(
          child: GestureDetector(
            onTap: () => Navigator.of(context).maybePop(),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 9, sigmaY: 9),
              child: Container(color: Colors.black.withValues(alpha: 0.32)),
            ),
          ),
        ),
        SafeArea(
          child: GestureDetector(
            onTap: () => Navigator.of(context).maybePop(),
            behavior: HitTestBehavior.opaque,
            child: Align(
            alignment: anchorTop ? Alignment.topCenter : Alignment.bottomCenter,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(10, 16, 10, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Align(
                    alignment: align,
                    child: _ReactionPill(
                      selected: selectedReactions,
                      onPick: (e) {
                        Navigator.of(context).pop();
                        onReact(e);
                      },
                      onMore: onMore == null
                          ? null
                          : () {
                              Navigator.of(context).pop();
                              onMore!();
                            },
                    ),
                  ),
                  const SizedBox(height: 10),
                  // The lifted message itself, on its proper side.
                  IgnorePointer(child: bubblePreview),
                  const SizedBox(height: 10),
                  Align(
                    alignment: align,
                    child: _ActionCard(actions: actions),
                  ),
                ],
              ),
            ),
          ),
          ),
        ),
      ],
    );
  }
}

class _ReactionPill extends StatelessWidget {
  final Set<String> selected;
  final void Function(String emoji) onPick;
  final VoidCallback? onMore;
  const _ReactionPill(
      {required this.selected, required this.onPick, this.onMore});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      elevation: 8,
      shadowColor: Colors.black.withValues(alpha: 0.3),
      borderRadius: BorderRadius.circular(30),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final e in _quickReactions)
              GestureDetector(
                onTap: () {
                  HapticFeedback.selectionClick();
                  onPick(e);
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: selected.contains(e)
                        ? scheme.primary.withValues(alpha: 0.22)
                        : Colors.transparent,
                  ),
                  child: Text(e, style: const TextStyle(fontSize: 23)),
                ),
              ),
            if (onMore != null)
              GestureDetector(
                onTap: onMore,
                child: Container(
                  margin: const EdgeInsets.only(left: 2),
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: scheme.surfaceContainerHighest.withValues(alpha: 0.7),
                  ),
                  child: Icon(Icons.add_rounded,
                      size: 22, color: scheme.onSurfaceVariant),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final List<MessageAction> actions;
  const _ActionCard({required this.actions});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 230, maxWidth: 300),
      child: Material(
        color: scheme.surface,
        elevation: 8,
        shadowColor: Colors.black.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < actions.length; i++) ...[
              if (i > 0)
                Divider(
                    height: 1,
                    thickness: 1,
                    color: scheme.outlineVariant.withValues(alpha: 0.25)),
              _ActionRow(action: actions[i]),
            ],
          ],
        ),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  final MessageAction action;
  const _ActionRow({required this.action});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = action.destructive ? scheme.error : scheme.onSurface;
    return InkWell(
      onTap: () {
        Navigator.of(context).pop();
        action.onTap();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Text(
                action.label,
                style: TextStyle(
                  color: color,
                  fontSize: 15.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 16),
            Icon(action.icon, size: 21, color: color),
          ],
        ),
      ),
    );
  }
}
