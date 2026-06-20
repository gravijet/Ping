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
