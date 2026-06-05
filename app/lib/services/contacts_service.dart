import 'package:flutter_contacts/flutter_contacts.dart';

/// A single device-address-book entry, reduced to just what we need to match it
/// against Ping: a display name plus the raw phone numbers and emails on it.
class LocalContact {
  final String displayName;
  final List<String> phones;
  final List<String> emails;

  const LocalContact({
    required this.displayName,
    required this.phones,
    required this.emails,
  });
}

/// Thin wrapper around `flutter_contacts`. It only ever reads the address book
/// locally — the actual matching happens on the server, which stores nothing.
class ContactsService {
  /// Ask for (or confirm) permission to read contacts. Returns whether granted.
  Future<bool> requestPermission() => FlutterContacts.requestPermission(readonly: true);

  /// Load all device contacts that carry at least one phone number or email.
  /// Skips entries with no reachable identifier — they can never match.
  Future<List<LocalContact>> loadContacts() async {
    final raw = await FlutterContacts.getContacts(
      withProperties: true,
      withPhoto: false,
      withThumbnail: false,
    );
    final out = <LocalContact>[];
    for (final c in raw) {
      final phones = c.phones
          .map((p) => p.number.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      final emails = c.emails
          .map((e) => e.address.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      if (phones.isEmpty && emails.isEmpty) continue;
      final name = c.displayName.trim();
      out.add(LocalContact(
        displayName: name.isEmpty
            ? (phones.isNotEmpty ? phones.first : emails.first)
            : name,
        phones: phones,
        emails: emails,
      ));
    }
    out.sort((a, b) =>
        a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase()));
    return out;
  }
}
