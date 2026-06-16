/// Named-blob persistence for the on-device caches (chat list, message history,
/// outbox, starred messages). Native builds keep these as JSON files under the
/// app's documents directory; the web build — a session-oriented second screen
/// like WhatsApp Web — keeps them in localStorage via shared_preferences.
///
/// A [name] may contain a single sub-folder (e.g. `messages/<id>.json`): on
/// native it becomes a real nested path, on web it's just part of the key. All
/// operations are best-effort and never throw — a failed read behaves as "no
/// data".
library;

export 'doc_store_web.dart' if (dart.library.io) 'doc_store_io.dart';
