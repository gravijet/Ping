/* flags.js — lightweight feature flags. Three layers, last one wins:
     1. built-in DEFAULTS (below),
     2. remote flags from GET /api/config (store.state.config.flags),
     3. local per-device overrides in localStorage (set from the debug panel).

   Use flag('name') anywhere to gate a feature; the debug panel (debug.js) lets
   a developer flip overrides live without a deploy. Keeping flags here — not
   scattered behind `if (location.search…)` checks — means there is one list to
   reason about and one switchboard to flip them from. */

import * as store from './store.js';

const LS_KEY = 'ping.flags';

// Built-in defaults. Add a flag here, reference it with flag('x'), done.
export const DEFAULTS = {
  outbox: true,          // persistent offline send-queue
  shareButtons: true,    // Web-Share / copy-link affordances
  diagnostics: true,     // allow the opt-in diagnostics module to run at all
  skeletons: true,       // skeleton loading states
  connectionBanner: true,// offline / reconnecting banner
  commandPalette: true,  // Ctrl/⌘+K palette (already shipped; flag for kill-switch)
  debugPanel: true,      // Ctrl+Shift+D developer panel
  mentions: true,        // @-mentions + member autocomplete in group chats
  drafts: true,          // per-chat unsent message drafts
  activityCenter: true,  // nav-rail bell + activity / notifications feed
  themeStudio: true,     // theme presets + custom accent + shareable theme codes
  insights: true,        // device-local usage insights in settings
  offlineCache: true,    // IndexedDB read-through cache (chat list + recent messages)
  syncReceipts: true,    // persist & replay read/delivered acks across reconnects
  profileLinks: true,    // shareable ?u=<id> profile/start-chat deep links
  perfMetrics: true,     // opt-in performance metrics (navigation/paint timing)
  amoledTheme: true,     // AMOLED true-black dark-mode variant
  deviceDiagnostics: true, // "Gerät" settings panel (battery/network/storage)
  adaptiveData: true,    // throttle prefetch on save-data / slow connections
  linkPreviews: true,    // rich OpenGraph link-preview cards under messages
  editHistory: true,     // tap "bearbeitet" to see a message's prior versions
  reminders: true,       // "Erinnere mich" — message reminders (server-fired)
  quickReplies: true,    // canned composer replies, synced across devices
  chatExport: true,      // full server-side per-chat transcript export (txt/json)
  messageSearch: true,   // FTS5 global search view with filters + highlighted snippets
  focusMode: true,       // focus mode / quiet hours + DM auto-reply (server-enforced)
  communities: true,     // public, discoverable broadcast channels ("Entdecken")
  usernames: true,       // public @usernames + people directory + /u/<name> links
  twoFactor: true,       // TOTP two-factor auth + recovery codes
  privacyControls: true, // who-can-DM / who-can-add-to-groups + security centre
  events: true,          // events ("Termine") with RSVP, reminders + agenda pane
  taskLists: true,       // collaborative task lists / checklists in chats
  // ── „Alles" (0.34.0) — Mega-Release ────────────────────────────────────
  threads: true,          // threaded replies / Antwortketten in any chat
  groupCalls: true,       // mesh group voice/video calls
  scheduledCalls: true,   // schedule a call with a reminder
  liveLocation: true,     // continuously-updating shared location
  voiceTranscription: true, // on-prem transcription of voice notes
  stickers: true,         // sticker packs
  gifSearch: true,        // server-proxied GIF search
  photoEditor: true,      // crop/markup/draw on images before sending
  viewOnce: true,         // view-once photos/videos
  chatThemes: true,       // per-chat wallpaper + accent, synced
  nowPlaying: true,       // "now playing" rich status
  boards: true,           // kanban boards
  groupNotes: true,       // collaborative group wiki / notes
  recurringEvents: true,  // recurring events
  chatMediaHub: true,     // shared media/files/links gallery per chat
  webhooks: true,         // incoming/outgoing webhooks + bots
  miniGames: true,        // in-chat mini-games
  e2ee: true,             // opt-in end-to-end encryption for DMs (beta)
  chatLock: true,         // per-chat lock / hidden chats
  loginApproval: true,    // approve new logins from an existing device
  defaultTtl: true,       // per-chat default disappearing-message timer
  screenshotAlerts: true, // screenshot notice
  translation: true,      // inline message translation
  catchUp: true,          // "Hol mich ab" unread summary (heuristic)
  smartReplies: true,     // heuristic suggested quick replies
  errorReporting: true,   // auto-send crash reports (Fehlerberichte) to the dev inbox
  // ── „Ausdruck & Werkbank" (0.35.0) ──────────────────────────────────────
  contactCards: true,     // share a Ping account as a rich, tappable contact card
  codeSnippets: true,     // share formatted code blocks with syntax highlighting + copy
  // ── „Zusammen" (0.36.0) — coordinate money & time ───────────────────────
  splitExpenses: true,    // shared expenses / split bills (Geteilte Kasse) + ledger + "Kasse" pane
  availabilityPolls: true,// find-a-time availability polls (Terminfindung) → event
  // ── „Feinschliff" (0.37.0) — curated polish features ────────────────────
  autoTranslate: true,      // per-chat auto-translation of incoming messages
  pollQuiz: true,           // quiz mode for polls (a correct answer + reveal)
  recurringReminders: true, // daily/weekly recurring message reminders
  smartFolders: true,       // keyword auto-sort rules for chat folders
  sendEffects: true,        // one-shot confetti/balloon/heart effect on send
  voiceDictation: true,     // on-device speech-to-text in the composer
  reactionDetails: true,    // "who reacted" detail sheet on a reaction
  anniversaries: true,      // birthday / anniversary hints for contacts
  // ══ „Universum" (0.38.0) — Mega-Release ═════════════════════════════════
  // A — new structured message types
  whiteboard: true,       // collaborative drawing canvas (type='whiteboard')
  collabDocs: true,       // shared collaborative mini-document (type='doc')
  playlists: true,        // shared playlist / "Listen Together" (type='playlist')
  recipes: true,          // structured recipe card (type='recipe')
  flashcards: true,       // study deck with quiz/review (type='flashcards')
  forms: true,            // multi-question form / survey (type='form')
  bookmarks: true,        // link collection / read-later card (type='bookmark')
  places: true,           // pinned-places map collection (type='place')
  videoNotes: true,       // round short video notes (type='videonote')
  watchParty: true,       // synced video watch-together (type='watchparty')
  // B — real-time & calls
  voiceRooms: true,       // persistent group audio rooms ("Räume")
  screenShare: true,      // screen sharing in calls
  callReactions: true,    // floating emoji reactions during calls
  // C — communities & groups 2.0
  communityHubs: true,    // parent communities grouping sub-chats + announcements
  groupRoles: true,       // richer roles / permissions in groups
  inviteLinks: true,      // shareable invite links with expiry + usage limits
  slowMode: true,         // slow mode + join-approval queue
  // D — local intelligence (on-device / self-hosted, no egress)
  assistantBot: true,     // @ping assistant (local Ollama or heuristic)
  smartCompose: true,     // composer sentence completion (on-device)
  chatSummary: true,      // improved extractive catch-up summary
  imageOcr: true,         // on-device OCR / alt-text for images
  spamGuard: true,        // heuristic scam/spam warning badge
  // E — social & fun
  achievements: true,     // achievements / badges + per-chat streaks
  profileShowcase: true,  // rich profile showcase (bio links, badges, pinned)
  virtualGifts: true,     // animated virtual gifts (type='gift')
  superReactions: true,   // large / animated reactions
  // F — productivity
  calendarView: true,     // unified agenda combining events/reminders/tasks/...
  habits: true,           // shared habit / streak tracker
  shoppingList: true,     // shared live shopping list
  // G — data & account
  accountBackup: true,    // encrypted account backup / restore
  multiAccount: true,     // account switcher (multiple sessions)
  panicMode: true,        // SOS / panic quick-lock
};

function localOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
  catch { return {}; }
}

/** Resolve a flag's effective value across all three layers. */
export function flag(name) {
  const local = localOverrides();
  if (Object.prototype.hasOwnProperty.call(local, name)) return !!local[name];
  const remote = store.state.config?.flags;
  if (remote && Object.prototype.hasOwnProperty.call(remote, name)) return !!remote[name];
  return !!DEFAULTS[name];
}

/** Set (or clear, with value === null) a local override and persist it. */
export function setFlag(name, value) {
  const local = localOverrides();
  if (value === null || value === undefined) delete local[name];
  else local[name] = !!value;
  localStorage.setItem(LS_KEY, JSON.stringify(local));
  store.emit('flags');
}

export function clearOverrides() {
  localStorage.removeItem(LS_KEY);
  store.emit('flags');
}

/** Snapshot of every known flag with its effective value + source — for the UI. */
export function allFlags() {
  const local = localOverrides();
  const remote = store.state.config?.flags || {};
  const names = new Set([...Object.keys(DEFAULTS), ...Object.keys(remote), ...Object.keys(local)]);
  return [...names].sort().map((name) => {
    let source = 'default';
    if (Object.prototype.hasOwnProperty.call(local, name)) source = 'override';
    else if (Object.prototype.hasOwnProperty.call(remote, name)) source = 'remote';
    return { name, value: flag(name), source, overridden: source === 'override' };
  });
}
