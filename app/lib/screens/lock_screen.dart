import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/app_state.dart';
import '../widgets/ping_logo.dart';

/// Full-screen PIN gate shown over the whole app when the local app-lock is
/// engaged. There is no way past it except the correct PIN — or the "forgot
/// PIN" escape hatch, which signs out and removes the lock.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key});

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen>
    with SingleTickerProviderStateMixin {
  String _entry = '';
  bool _error = false;
  bool _confirmForgot = false;
  late final AnimationController _shake = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );

  static const _maxLen = 8;

  @override
  void dispose() {
    _shake.dispose();
    super.dispose();
  }

  void _press(String digit) {
    if (_entry.length >= _maxLen) return;
    setState(() {
      _entry += digit;
      _error = false;
    });
    if (_entry.length >= 4) _tryUnlock();
  }

  void _backspace() {
    if (_entry.isEmpty) return;
    setState(() => _entry = _entry.substring(0, _entry.length - 1));
  }

  void _tryUnlock() {
    final state = context.read<AppState>();
    if (state.tryUnlock(_entry)) {
      HapticFeedback.lightImpact();
      // The gate disappears because [appLocked] flips to false.
    } else if (_entry.length >= _maxLen) {
      _fail();
    }
  }

  void _submit() {
    final state = context.read<AppState>();
    if (!state.tryUnlock(_entry)) _fail();
  }

  void _fail() {
    HapticFeedback.heavyImpact();
    _shake.forward(from: 0);
    setState(() {
      _error = true;
      _entry = '';
    });
  }

  Future<void> _doForgotLogout() async {
    final state = context.read<AppState>();
    await state.disableAppLock();
    await state.logout();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.surface,
      body: Stack(
        children: [
          _buildPinPad(context, scheme),
          if (_confirmForgot) _buildForgotPanel(context, scheme),
        ],
      ),
    );
  }

  Widget _buildPinPad(BuildContext context, ColorScheme scheme) {
    return SafeArea(
      child: Column(
          children: [
            const Spacer(flex: 2),
            const PingLogo(size: 68),
            const SizedBox(height: 20),
            Text('Ping ist gesperrt',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 6),
            Text(
              _error ? 'Falscher PIN — versuch es erneut' : 'PIN eingeben',
              style: TextStyle(
                color: _error ? scheme.error : scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 28),
            AnimatedBuilder(
              animation: _shake,
              builder: (context, child) {
                // A horizontal shake that oscillates a few times and decays.
                final t = _shake.value;
                final dx = math.sin(t * math.pi * 6) * 12 * (1 - t);
                return Transform.translate(offset: Offset(dx, 0), child: child);
              },
              child: _Dots(count: _entry.length, error: _error, scheme: scheme),
            ),
            const Spacer(flex: 2),
            _Keypad(onDigit: _press, onBackspace: _backspace, onSubmit: _submit),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() => _confirmForgot = true),
              child: const Text('PIN vergessen?'),
            ),
            const SizedBox(height: 12),
          ],
        ),
    );
  }

  /// Inline confirmation for the "forgot PIN" escape hatch. Rendered in-place
  /// because the lock screen lives above the app's Navigator, so it can't open a
  /// dialog of its own.
  Widget _buildForgotPanel(BuildContext context, ColorScheme scheme) {
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black.withValues(alpha: 0.55),
        child: Center(
          child: Container(
            margin: const EdgeInsets.all(28),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.lock_reset_rounded, size: 40, color: scheme.primary),
                const SizedBox(height: 12),
                Text('PIN vergessen?',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                  'Zum Entsperren kannst du dich abmelden — die App-Sperre wird '
                  'dabei entfernt. Deine Chats bleiben auf dem Server erhalten '
                  'und sind nach der nächsten Anmeldung wieder da.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () =>
                            setState(() => _confirmForgot = false),
                        child: const Text('Abbrechen'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                            backgroundColor: scheme.error),
                        onPressed: _doForgotLogout,
                        child: const Text('Abmelden'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  final int count;
  final bool error;
  final ColorScheme scheme;
  const _Dots({required this.count, required this.error, required this.scheme});

  @override
  Widget build(BuildContext context) {
    final shown = count.clamp(0, 8);
    final filledColor = error ? scheme.error : scheme.primary;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < (shown < 4 ? 4 : shown); i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            margin: const EdgeInsets.symmetric(horizontal: 7),
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i < count ? filledColor : Colors.transparent,
              border: Border.all(
                color: i < count ? filledColor : scheme.outline,
                width: 2,
              ),
            ),
          ),
      ],
    );
  }
}

class _Keypad extends StatelessWidget {
  final void Function(String) onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onSubmit;
  const _Keypad({
    required this.onDigit,
    required this.onBackspace,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    Widget key(String label, {VoidCallback? onTap, Widget? child}) {
      return Padding(
        padding: const EdgeInsets.all(8),
        child: SizedBox(
          width: 76,
          height: 76,
          child: Material(
            color: Theme.of(context)
                .colorScheme
                .surfaceContainerHighest
                .withValues(alpha: 0.5),
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap ?? () => onDigit(label),
              child: Center(
                child: child ??
                    Text(label,
                        style: const TextStyle(
                            fontSize: 26, fontWeight: FontWeight.w600)),
              ),
            ),
          ),
        ),
      );
    }

    Widget row(List<Widget> kids) =>
        Row(mainAxisAlignment: MainAxisAlignment.center, children: kids);

    return Column(
      children: [
        row([key('1'), key('2'), key('3')]),
        row([key('4'), key('5'), key('6')]),
        row([key('7'), key('8'), key('9')]),
        row([
          key('', onTap: onSubmit, child: const Icon(Icons.check_rounded)),
          key('0'),
          key('', onTap: onBackspace, child: const Icon(Icons.backspace_outlined)),
        ]),
      ],
    );
  }
}
