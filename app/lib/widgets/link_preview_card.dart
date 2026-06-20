import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/link_preview_service.dart';

/// A compact OpenGraph preview card shown under a chat message that contains a
/// link (0.28.0 "Kontext"). Loads lazily via [fetch]; renders nothing until (and
/// unless) a usable preview resolves, so a link with no metadata leaves no trace.
class LinkPreviewCard extends StatefulWidget {
  final String url;
  final Future<LinkPreview?> Function(String url) fetch;
  final bool isMine;
  final Color fg;

  const LinkPreviewCard({
    super.key,
    required this.url,
    required this.fetch,
    required this.isMine,
    required this.fg,
  });

  @override
  State<LinkPreviewCard> createState() => _LinkPreviewCardState();
}

class _LinkPreviewCardState extends State<LinkPreviewCard> {
  LinkPreview? _preview;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(LinkPreviewCard old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url) {
      _preview = null;
      _done = false;
      _load();
    }
  }

  Future<void> _load() async {
    final p = await widget.fetch(widget.url);
    if (!mounted) return;
    setState(() {
      _preview = p;
      _done = true;
    });
  }

  Future<void> _open() async {
    final uri = Uri.tryParse(_preview?.url ?? widget.url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      /* no handler for the scheme — silently ignore */
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _preview;
    if (!_done || p == null) return const SizedBox.shrink();

    final onMine = widget.isMine;
    final fg = widget.fg;
    final bg = onMine
        ? Colors.black.withValues(alpha: 0.16)
        : Colors.white.withValues(alpha: 0.06);
    final accent =
        onMine ? Colors.white.withValues(alpha: 0.8) : Theme.of(context).colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: _open,
            child: Container(
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(10),
                border: Border(left: BorderSide(color: accent, width: 3)),
              ),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (p.image.isNotEmpty)
                      ClipRRect(
                        borderRadius: const BorderRadius.horizontal(
                            left: Radius.circular(8)),
                        child: Image.network(
                          p.image,
                          width: 70,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const SizedBox.shrink(),
                        ),
                      ),
                    Flexible(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (p.siteName.isNotEmpty)
                              Text(
                                p.siteName.toUpperCase(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: accent,
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.3,
                                ),
                              ),
                            Text(
                              p.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: fg,
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                height: 1.25,
                              ),
                            ),
                            if (p.description.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(
                                  p.description,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: fg.withValues(alpha: 0.75),
                                    fontSize: 12,
                                    height: 1.3,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
