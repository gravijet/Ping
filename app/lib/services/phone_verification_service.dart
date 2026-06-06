import 'package:firebase_auth/firebase_auth.dart';

/// Wraps Firebase phone-number verification. On Android this is backed by Play
/// Integrity; on many devices the SMS code is auto-retrieved so the user never
/// types it (instant verification). We only use it to obtain a short-lived
/// Firebase **ID token** whose `phone_number` claim proves ownership — the Ping
/// server verifies that token, so the proof can't be faked client-side.
class PhoneVerificationService {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Start verifying [e164Phone] (must be in `+<country><number>` form).
  ///
  /// - [onAutoVerified]: the platform verified instantly — here's the ID token.
  /// - [onCodeSent]: an SMS code was sent; keep [verificationId] for [confirmCode].
  /// - [onError]: a friendly, user-facing message.
  Future<void> start(
    String e164Phone, {
    required void Function(String idToken) onAutoVerified,
    required void Function(String verificationId) onCodeSent,
    required void Function(String message) onError,
  }) async {
    await _auth.verifyPhoneNumber(
      phoneNumber: e164Phone,
      verificationCompleted: (cred) async {
        try {
          final token = await _signInAndGetToken(cred);
          if (token != null) {
            onAutoVerified(token);
          } else {
            onError('Automatische Verifizierung fehlgeschlagen.');
          }
        } catch (_) {
          onError('Automatische Verifizierung fehlgeschlagen.');
        }
      },
      verificationFailed: (e) =>
          onError(_message(e.code, e.message)),
      codeSent: (verificationId, _) => onCodeSent(verificationId),
      codeAutoRetrievalTimeout: (_) {},
      timeout: const Duration(seconds: 60),
    );
  }

  /// Confirm the SMS [code] for [verificationId]; returns a Firebase ID token.
  Future<String?> confirmCode(String verificationId, String code) async {
    final cred = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: code.trim(),
    );
    return _signInAndGetToken(cred);
  }

  Future<String?> _signInAndGetToken(PhoneAuthCredential cred) async {
    final result = await _auth.signInWithCredential(cred);
    final token = await result.user?.getIdToken();
    // We only needed proof of ownership — don't keep a lingering Firebase session.
    await _auth.signOut();
    return token;
  }

  String _message(String code, String? fallback) {
    switch (code) {
      case 'invalid-phone-number':
        return 'Diese Telefonnummer ist ungültig.';
      case 'too-many-requests':
        return 'Zu viele Versuche. Bitte versuch es später erneut.';
      case 'quota-exceeded':
        return 'Verifizierung gerade nicht möglich. Bitte später erneut.';
      case 'network-request-failed':
        return 'Keine Verbindung. Prüfe dein Internet.';
      default:
        return fallback ?? 'Verifizierung fehlgeschlagen.';
    }
  }
}
