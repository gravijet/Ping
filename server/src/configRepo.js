import { db, now } from './db.js';

// Server-driven runtime configuration. The app fetches this at /api/config and
// caches it, so feature flags, limits, an app-wide notice and a "minimum
// supported build" can all change without publishing a new APK.

const CONFIG_KEY = 'remote';

// Built-in defaults. The stored row only needs to carry *overrides*; we merge it
// over these, so adding a new flag here works immediately without a migration.
export const DEFAULT_CONFIG = {
  flags: {
    polls: true,
    status: true,
    voiceNotes: true,
    reactions: true,
    // Channels / Communities (0.31.0): public, discoverable broadcast channels.
    communities: true,
    calls: false,
    // Device-Intelligence (0.24.0): live diagnostics surface, adaptive
    // data/battery behaviour, and the anonymous device-fleet telemetry.
    deviceDiagnostics: true,
    adaptiveData: true,
    deviceTelemetry: true,
    // Kontext (0.28.0): rich link previews + message edit-history viewer.
    linkPreviews: true,
    editHistory: true,
    // Erinnerung & Schnellzugriff (0.29.0): message reminders, quick replies,
    // per-chat transcript export.
    reminders: true,
    quickReplies: true,
    chatExport: true,
    // Finden & Fokus (0.30.0): FTS5 full-text search with filters + a
    // server-enforced focus mode / quiet hours with DM auto-reply.
    messageSearch: true,
    focusMode: true,
    // Identität & Schutz (0.32.0): public @usernames + people directory,
    // two-factor auth (TOTP), expanded privacy controls + security centre.
    usernames: true,
    twoFactor: true,
    privacyControls: true,
    // Pläne & Aufgaben (0.33.0): events with RSVP + reminders, and shared
    // collaborative task lists / checklists.
    events: true,
    taskLists: true,
    // ── „Alles" (0.34.0) — Mega-Release, 25 Features ──────────────────────
    // A. Kommunikation & Anrufe
    threads: true,            // threaded replies / Antwortketten in any chat
    groupCalls: true,         // mesh group voice/video (rides on the calls infra)
    scheduledCalls: true,     // schedule a call; reminder fired by the sweep
    liveLocation: true,       // continuously-updating shared location (livelocation type)
    voiceTranscription: true, // on-prem Whisper transcription of voice notes (needs WHISPER_BIN)
    // B. Medien & Ausdruck
    stickers: true,           // sticker packs (sticker message type)
    gifSearch: true,          // server-proxied GIF search (needs GIPHY_KEY; TENOR_KEY legacy, dead after 2026-06-30)
    photoEditor: true,        // crop/markup/draw on images before sending (client-only)
    viewOnce: true,           // view-once photos/videos
    chatThemes: true,         // per-chat wallpaper + accent, synced
    nowPlaying: true,         // "now playing" rich status
    // C. Produktivität & Organisation
    boards: true,             // kanban boards (board message type)
    groupNotes: true,         // collaborative group wiki / notes
    recurringEvents: true,    // recurring events (RRULE-lite)
    chatMediaHub: true,       // shared media/files/links gallery per chat
    webhooks: true,           // incoming/outgoing webhooks + slash-command bots
    miniGames: true,          // in-chat mini-games (game message type)
    // D. Sicherheit & Privatsphäre
    e2ee: true,               // opt-in end-to-end encryption for DMs (beta)
    chatLock: true,           // per-chat lock / hidden chats
    loginApproval: true,      // approve new logins from an existing device
    defaultTtl: true,         // per-chat default disappearing-message timer
    screenshotAlerts: true,   // screenshot notice (Android native; degrades elsewhere)
    // E. Smart / KI — sparsam & privat
    translation: true,        // inline message translation (needs LIBRETRANSLATE_URL)
    catchUp: true,            // "Hol mich ab" unread summary (heuristic, on-device)
    smartReplies: true,       // heuristic suggested quick replies
    // Diagnose: auto-send crash reports (Fehlerberichte) to the dev bug inbox.
    // Crashes only carry a stack trace + anonymous device id, never message
    // content — kill-switch here if a noisy build needs muting.
    errorReporting: true,
    // ── „Ausdruck & Werkbank" (0.35.0) ───────────────────────────────────
    contactCards: true,   // share a Ping account as a rich, tappable contact card
    codeSnippets: true,   // share formatted code blocks with one-tap copy
    labMode: true,        // power-user "Labor": live theme editor + local flag overrides
    // ── „Zusammen" (0.36.0) — coordinate money & time ─────────────────────
    splitExpenses: true,    // shared expenses / split bills (Geteilte Kasse) + ledger
    availabilityPolls: true, // find-a-time availability polls (Terminfindung)
    // ── „Feinschliff" (0.37.0) — curated polish features ──────────────────
    autoTranslate: true,      // per-chat auto-translation of incoming messages
    pollQuiz: true,           // quiz mode for polls (a correct answer + reveal)
    recurringReminders: true, // daily/weekly recurring message reminders
    smartFolders: true,       // keyword auto-sort rules for chat folders
    sendEffects: true,        // one-shot confetti/balloon/heart effect on send
    voiceDictation: true,     // on-device speech-to-text in the composer
    reactionDetails: true,    // "who reacted" detail sheet on a reaction
    anniversaries: true,      // birthday / anniversary hints for contacts
    // ── „Universum" (0.38.0) — Mega-Release ───────────────────────────────
    // A — new structured message types (one FTS-aware type-CHECK widening)
    whiteboard: true,         // collaborative drawing canvas (type='whiteboard')
    collabDocs: true,         // shared collaborative mini-document (type='doc')
    playlists: true,          // shared playlist / "Listen Together" (type='playlist')
    recipes: true,            // structured recipe card (type='recipe')
    flashcards: true,         // study deck with quiz/review (type='flashcards')
    forms: true,              // multi-question form / survey (type='form')
    bookmarks: true,          // link collection / read-later card (type='bookmark')
    places: true,             // pinned-places map collection (type='place')
    videoNotes: true,         // round short video notes (type='videonote')
    watchParty: true,         // synced video watch-together (type='watchparty')
    // B — real-time & calls
    voiceRooms: true,         // persistent group audio rooms ("Räume")
    screenShare: true,        // screen sharing in calls
    callReactions: true,      // floating emoji reactions during calls
    // C — communities & groups 2.0
    communityHubs: true,      // parent communities grouping sub-chats + announcements
    groupRoles: true,         // richer roles / permissions in groups
    inviteLinks: true,        // shareable invite links with expiry + usage limits
    slowMode: true,           // slow mode + join-approval queue
    // D — local intelligence (on-device / self-hosted, no egress; opt-in OLLAMA_URL)
    assistantBot: true,       // @ping assistant (local Ollama or heuristic)
    smartCompose: true,       // composer sentence completion (on-device)
    chatSummary: true,        // improved extractive catch-up summary
    imageOcr: true,           // on-device OCR / alt-text for images (TESSERACT_BIN)
    spamGuard: true,          // heuristic scam/spam warning badge
    // E — social & fun
    achievements: true,       // achievements / badges + per-chat streaks
    profileShowcase: true,    // rich profile showcase (bio links, badges, pinned)
    virtualGifts: true,       // animated virtual gifts (type='gift')
    superReactions: true,     // large / animated reactions
    // F — productivity
    calendarView: true,       // unified agenda combining events/reminders/tasks/...
    habits: true,             // shared habit / streak tracker
    shoppingList: true,       // shared live shopping list
    // G — data & account
    accountBackup: true,      // encrypted account backup / restore
    multiAccount: true,       // account switcher (multiple sessions)
    panicMode: true,          // SOS / panic quick-lock
  },
  values: {
    maxStatusSeconds: 30,
    inviteUrl: '',
  },
  // An app-wide banner, or null. level: 'info' | 'warning' | 'critical'.
  notice: null,
  // Maintenance mode: when active, the app shows a full-screen "kurz nicht
  // erreichbar" notice with this message. Off by default.
  maintenance: { active: false, message: '' },
  // Apps whose Android versionCode is below this are nudged to update; a
  // 'critical' notice can turn that into a hard gate on the client.
  minSupportedBuild: 0,
};

const stmt = {
  get: db.prepare('SELECT value FROM app_config WHERE key = ?'),
  set: db.prepare(`
    INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
};

function readStored() {
  try {
    const row = stmt.get.get(CONFIG_KEY);
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

/// The effective config: stored overrides merged over the built-in defaults.
export function getRemoteConfig() {
  const s = readStored();
  return {
    flags: { ...DEFAULT_CONFIG.flags, ...(s.flags || {}) },
    values: { ...DEFAULT_CONFIG.values, ...(s.values || {}) },
    notice: s.notice ?? DEFAULT_CONFIG.notice,
    maintenance: {
      ...DEFAULT_CONFIG.maintenance,
      ...(s.maintenance && typeof s.maintenance === 'object' ? s.maintenance : {}),
    },
    minSupportedBuild: Number.isInteger(s.minSupportedBuild)
      ? s.minSupportedBuild
      : DEFAULT_CONFIG.minSupportedBuild,
    updatedAt: s.updatedAt || 0,
  };
}

/// Merge a partial update into the stored config. flags/values merge key-by-key;
/// notice and minSupportedBuild replace wholesale (pass notice: null to clear).
export function setRemoteConfig(patch = {}) {
  const cur = getRemoteConfig();
  const next = {
    flags: { ...cur.flags, ...(patch.flags || {}) },
    values: { ...cur.values, ...(patch.values || {}) },
    notice: patch.notice !== undefined ? patch.notice : cur.notice,
    maintenance:
      patch.maintenance !== undefined
        ? { ...cur.maintenance, ...(patch.maintenance || {}) }
        : cur.maintenance,
    minSupportedBuild:
      patch.minSupportedBuild !== undefined
        ? patch.minSupportedBuild
        : cur.minSupportedBuild,
    updatedAt: now(),
  };
  stmt.set.run(CONFIG_KEY, JSON.stringify(next), next.updatedAt);
  return getRemoteConfig();
}
