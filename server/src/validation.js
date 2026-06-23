import { z } from 'zod';
import { config } from './config.js';

// Friendly German validation messages — these surface directly in the app.

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte gib einen Namen ein.')
  .max(40, 'Der Name darf höchstens 40 Zeichen haben.');

export const aboutSchema = z
  .string()
  .trim()
  .max(300, 'Über mich darf höchstens 300 Zeichen haben.');

export const avatarColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Ungültige Farbe.');

export const passwordSchema = z
  .string()
  .min(6, 'Das Passwort braucht mindestens 6 Zeichen.')
  .max(200, 'Das Passwort ist zu lang.');

export const emailSchema = z
  .string()
  .trim()
  .max(160, 'Die E-Mail-Adresse ist zu lang.')
  .email('Das sieht nicht nach einer gültigen E-Mail-Adresse aus.');

// Raw phone input; canonicalisation happens in the route via normalizePhone.
export const phoneInputSchema = z
  .string()
  .trim()
  .min(4, 'Bitte gib deine Handynummer ein.')
  .max(32, 'Diese Nummer ist zu lang.');

// Registration needs all three: phone, email and password (plus a name).
export const registerSchema = z.object({
  phone: phoneInputSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginSchema = z.object({
  login: z.string().trim().min(3, 'Bitte gib deine Nummer oder E-Mail ein.'),
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
});

// Desktop device-linking: the phone approves a QR-shown `code`. The optional
// label lets the phone name the device ("Windows-PC") for the approval prompt.
export const linkApproveSchema = z.object({
  code: z.string().trim().min(8, 'Ungültiger Verknüpfungscode.').max(200),
  deviceLabel: z.string().trim().max(60).optional(),
});

// SMS one-time-code verification. The purpose decides which accounts may
// request a code: 'register' (default) needs a *free* number, 'reset' needs an
// *existing* account (password reset).
export const requestCodeSchema = z.object({
  phone: phoneInputSchema,
  purpose: z.enum(['register', 'reset']).optional(),
});
export const verifyCodeSchema = z.object({
  phone: phoneInputSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Bitte gib den Code aus der SMS ein.'),
});

// Set a new password after proving phone ownership via the SMS code flow.
export const resetPasswordSchema = z.object({
  phone: phoneInputSchema,
  verifyToken: z.string().min(10, 'Verifizierung fehlt.'),
  password: passwordSchema,
});

// An accent colour or "" (the empty string clears it, reverting to the
// auto-assigned avatar colour).
const accentColorSchema = avatarColorSchema.or(z.literal(''));

// A profile link chip: a short label plus an http(s) URL.
export const profileLinkSchema = z.object({
  label: z.string().trim().max(30, 'Das Link-Label ist zu lang.').optional().default(''),
  url: z
    .string()
    .trim()
    .min(1, 'Der Link darf nicht leer sein.')
    .max(200, 'Der Link ist zu lang.')
    .regex(/^https?:\/\/.+/i, 'Links müssen mit http:// oder https:// beginnen.'),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  about: aboutSchema.optional(),
  avatarColor: avatarColorSchema.optional(),
  accentColor: accentColorSchema.optional(),
  pronouns: z.string().trim().max(40, 'Die Pronomen sind zu lang.').optional(),
  // 'YYYY-MM-DD', 'MM-DD' or '' (cleared).
  birthday: z
    .string()
    .trim()
    .regex(/^(\d{4}-)?\d{2}-\d{2}$/, 'Ungültiges Datum.')
    .or(z.literal(''))
    .optional(),
  city: z.string().trim().max(60, 'Der Ort ist zu lang.').optional(),
  links: z.array(profileLinkSchema).max(6, 'Höchstens 6 Links.').optional(),
  moodEmoji: z.string().trim().max(16, 'Ungültiges Emoji.').optional(),
  moodText: z.string().trim().max(80, 'Der Status ist zu lang.').optional(),
  // Epoch-ms expiry for the mood, or null to keep it until cleared.
  moodUntil: z.number().int().nonnegative().max(4102444800000).nullable().optional(),
});

export const securitySchema = z
  .object({
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    currentPassword: z.string().optional(),
  })
  .refine((d) => d.email !== undefined || d.password !== undefined, {
    message: 'Gib eine E-Mail-Adresse oder ein Passwort an.',
  });

// Editing only ever changes text, so this stays strict (non-empty).
export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Leere Nachrichten kannst du nicht senden.')
  .max(4000, 'Die Nachricht ist zu lang (max. 4000 Zeichen).');

const mediaTypes = ['text', 'image', 'gif', 'video', 'audio', 'voice', 'file'];

// An uploaded attachment. The url must point at our own /api/uploads/<id> so a
// client can never smuggle in an arbitrary external/inline URL.
export const attachmentSchema = z
  .object({
    kind: z.enum(['image', 'gif', 'video', 'audio', 'voice', 'file']).optional(),
    url: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .startsWith('/api/uploads/', 'Ungültiger Anhang.'),
    mime: z.string().max(120).optional(),
    name: z.string().max(200).optional(),
    size: z.number().int().nonnegative().max(config.maxUploadBytes).optional(),
    width: z.number().int().nonnegative().max(20000).optional(),
    height: z.number().int().nonnegative().max(20000).optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .strip();

// Sending a message: plain text, or a typed attachment with an optional caption.
export const messageSendSchema = z
  .object({
    body: z.string().max(8000, 'Die Nachricht ist zu lang.').optional(),
    type: z.enum(mediaTypes).optional(),
    attachment: attachmentSchema.optional(),
    replyTo: z.string().min(1).optional(),
    // 0.34.0: view-once media + E2EE ciphertext flag. enc relaxes the
    // text-needs-body rule (the body is opaque ciphertext).
    viewOnce: z.boolean().optional(),
    enc: z.boolean().optional(),
    // 0.37.0: one-shot send effect played on arrival.
    effect: z.enum(['confetti', 'balloons', 'hearts']).optional(),
  })
  .refine(
    (d) => {
      if (d.enc) return !!d.body; // ciphertext lives in body
      const t = d.type || 'text';
      return t === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment;
    },
    { message: 'Die Nachricht braucht Text oder einen Anhang.' }
  );

// ---- Developer API (/api/v1) ----------------------------------------------
// English copy here on purpose: these errors surface to integration developers,
// not end users.

// Sending via the public API. Same content rules as messageSendSchema, plus an
// optional `to` (user id / phone / email) used by POST /api/v1/messages to
// address a recipient directly. `to` is ignored when posting into a known chat.
export const apiSendSchema = z
  .object({
    to: z.string().trim().min(1).max(160).optional(),
    body: z.string().max(4000, 'The message is too long (max 4000 characters).').optional(),
    type: z.enum(mediaTypes).optional(),
    attachment: attachmentSchema.optional(),
    replyTo: z.string().min(1).optional(),
  })
  .refine(
    (d) => {
      const t = d.type || 'text';
      return t === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment;
    },
    { message: 'A message needs text or an attachment.' }
  );

// Opening a direct chat via the public API: at least one identifier required.
export const apiDirectSchema = z
  .object({
    to: z.string().trim().min(1).max(160).optional(),
    userId: z.string().trim().min(1).max(80).optional(),
    phone: phoneInputSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((d) => d.to || d.userId || d.phone || d.email, {
    message: 'Provide a "to", "userId", "phone" or "email".',
  });

// Minting a developer API key from the in-app/account settings.
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().max(60, 'The key name is too long.').optional(),
  scopes: z.array(z.string().max(40)).max(10).optional(),
});

// A "send later" message: the same content as a normal message plus the epoch
// millisecond timestamp it should go out at (validated as future in the route).
export const scheduleSchema = z
  .object({
    body: z.string().max(4000, 'Die Nachricht ist zu lang.').optional(),
    type: z.enum(mediaTypes).optional(),
    attachment: attachmentSchema.optional(),
    replyTo: z.string().min(1).optional(),
    sendAt: z.number().int(),
  })
  .refine(
    (d) => {
      const t = d.type || 'text';
      return t === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment;
    },
    { message: 'Die Nachricht braucht Text oder einen Anhang.' }
  );

// A status update ("story"): coloured text card, or an image with a caption.
export const statusSchema = z
  .object({
    type: z.enum(['text', 'image', 'video']).optional(),
    body: z.string().max(700, 'Der Status ist zu lang.').optional(),
    attachment: attachmentSchema.optional(),
    bgColor: avatarColorSchema.optional(),
  })
  .refine(
    (d) => {
      const t = d.type || 'text';
      // Text needs a body; image/video need an attachment.
      return t === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment;
    },
    { message: 'Ein Status braucht Text, ein Bild oder ein Video.' }
  );

// A call-log entry the client posts when a call ends. duration is in seconds.
export const callLogSchema = z.object({
  peerId: z.string().min(1, 'Gesprächspartner fehlt.'),
  callId: z.string().min(1).max(64),
  direction: z.enum(['incoming', 'outgoing']),
  video: z.boolean().optional(),
  outcome: z.enum(['completed', 'missed', 'declined', 'canceled', 'failed']),
  duration: z.number().int().nonnegative().max(86_400).optional(),
});

// Start a direct chat by user id or phone number. Discovery by email was
// removed on purpose — people are found only by their phone number.
export const directChatSchema = z
  .object({
    userId: z.string().min(1).optional(),
    phone: phoneInputSchema.optional(),
  })
  .refine((d) => d.userId || d.phone, {
    message: 'Gib eine Handynummer oder einen Kontakt an.',
  });

// Exact lookup is phone-only (email is a login credential, not a directory key).
export const lookupSchema = z.object({ phone: phoneInputSchema });

// Contact discovery matches phone numbers only.
export const matchSchema = z.object({
  phones: z.array(z.string()).max(config.maxContactMatch).optional(),
});

export const createGroupChatSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Bitte gib der Gruppe einen Namen.')
    .max(40, 'Der Gruppenname darf höchstens 40 Zeichen haben.'),
  memberIds: z.array(z.string().min(1)).max(256).optional(),
});

// ---- Channels / Communities (0.31.0) ---------------------------------------
// A handle is the channel's public, URL-safe identity: 3-30 chars, lower-case
// letters/digits/-/_, must start and end alphanumeric. Stored normalized.
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^@+/, ''))
  .pipe(
    z
      .string()
      .min(3, 'Der Handle braucht mindestens 3 Zeichen.')
      .max(30, 'Der Handle darf höchstens 30 Zeichen haben.')
      .regex(
        /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])$/,
        'Nur Kleinbuchstaben, Ziffern, „-" und „_" — Anfang und Ende alphanumerisch.'
      )
  );

// A small fixed set keeps the directory tidy and the filter UI simple.
export const CHANNEL_CATEGORIES = [
  'Nachrichten', 'Technik', 'Unterhaltung', 'Sport',
  'Bildung', 'Community', 'Kunst', 'Sonstiges',
];

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Bitte gib dem Kanal einen Namen.')
    .max(40, 'Der Kanalname darf höchstens 40 Zeichen haben.'),
  handle: handleSchema,
  description: z.string().trim().max(280, 'Die Beschreibung ist zu lang (max. 280).').optional(),
  category: z.enum(CHANNEL_CATEGORIES).optional(),
});

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().max(280).optional(),
    category: z.enum(CHANNEL_CATEGORIES).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Nichts zu ändern.');

export const channelDirectorySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(CHANNEL_CATEGORIES).optional(),
});

// ---- Admin -----------------------------------------------------------------

export const adminCreateSchema = z.object({
  phone: phoneInputSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  isAdmin: z.boolean().optional(),
});

export const adminUpdateSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    password: passwordSchema.optional(),
    isAdmin: z.boolean().optional(),
    email: emailSchema.optional(),
    about: aboutSchema.optional(),
    disabled: z.boolean().optional(),
    premium: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.password !== undefined ||
      d.isAdmin !== undefined ||
      d.email !== undefined ||
      d.about !== undefined ||
      d.disabled !== undefined ||
      d.premium !== undefined,
    { message: 'Nichts zu ändern.' }
  );

// The set of in-app destinations an admin notification can deep-link to. Kept
// in sync with the app's notification router (AppRoutes). 'home' is the default.
export const appRouteSchema = z.enum([
  'home',
  'settings',
  'privacy',
  'notifications',
  'design',
  'security',
  'backup',
  'saved',
  'update',
  'profile',
]);

export const adminBroadcastSchema = z.object({
  title: z.string().trim().max(80).optional(),
  body: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine Nachricht ein.')
    .max(2000, 'Die Durchsage ist zu lang.'),
  // Optional deep-link: which screen the app opens when the notification is
  // tapped (e.g. 'privacy' for the privacy settings). Defaults to the inbox.
  route: appRouteSchema.optional(),
  // Optional future epoch-ms timestamp. When set (and in the future) the
  // broadcast is queued and fired by the maintenance sweep instead of now.
  scheduledAt: z.number().int().positive().optional(),
});

export const messageStorageSchema = z.object({
  mode: z.enum(['server', 'local']),
});

// Joining a group via its shareable invite code.
export const joinSchema = z.object({
  code: z.string().trim().min(4, 'Ungültiger Code.').max(64),
});

// An app-wide notice banner pushed via remote config (no app update needed).
export const noticeSchema = z
  .object({
    text: z.string().trim().min(1).max(300),
    level: z.enum(['info', 'warning', 'critical']).default('info'),
    route: appRouteSchema.optional(),
  })
  .strict();

// App-wide maintenance mode pushed via remote config (no app update needed).
export const maintenanceSchema = z
  .object({
    active: z.boolean(),
    message: z.string().trim().max(300).optional().default(''),
  })
  .strict();

// A partial update to the server-driven runtime config (admin only).
export const remoteConfigSchema = z
  .object({
    flags: z.record(z.boolean()).optional(),
    values: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    notice: noticeSchema.nullable().optional(),
    maintenance: maintenanceSchema.optional(),
    minSupportedBuild: z.number().int().min(0).max(1000000).optional(),
  })
  .strict();

// Per-account privacy switches. Every field optional so a client can PATCH just
// one toggle; the route requires at least one. 'everyone' | 'contacts' axes gate
// who may DM you / add you to groups; showLastSeen + usernameSearchable are
// booleans. The legacy { showLastSeen } body from older clients still validates.
const reachSchema = z.enum(['everyone', 'contacts']);
export const privacySchema = z
  .object({
    showLastSeen: z.boolean().optional(),
    messages: reachSchema.optional(),
    groups: reachSchema.optional(),
    usernameSearchable: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Nichts zu ändern.');

// ---- Identität & Schutz (0.32.0): usernames + two-factor auth --------------

// A claimable public @username. Same character family as channel handles, with
// a stricter length and a tolerant leading-@ strip so "@Alice" → "alice".
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^@+/, ''))
  .pipe(
    z
      .string()
      .min(3, 'Der Benutzername braucht mindestens 3 Zeichen.')
      .max(24, 'Der Benutzername darf höchstens 24 Zeichen haben.')
      .regex(
        /^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/,
        'Nur Kleinbuchstaben, Ziffern und „_" — Anfang und Ende alphanumerisch.'
      )
  );

export const setUsernameSchema = z.object({ username: usernameSchema });

// People-directory query: a name fragment or @handle, 2–40 chars.
export const peopleSearchSchema = z
  .string()
  .trim()
  .min(2, 'Bitte gib mindestens 2 Zeichen ein.')
  .max(40, 'Die Suche ist zu lang.');

// A 6-digit TOTP code (spaces tolerated, e.g. "123 456").
const totpCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Bitte gib den 6-stelligen Code ein.'));

export const twofaEnableSchema = z.object({ code: totpCodeSchema });

// Disabling / regenerating require the account password as a second factor so a
// hijacked, already-authenticated session can't silently weaken the account.
export const twofaDisableSchema = z.object({
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
  code: totpCodeSchema.optional(),
});

export const twofaRegenerateSchema = z.object({
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
});

// Step 2 of login when 2FA is on: the challenge token plus either a TOTP code or
// a recovery code. Exactly one of the two must be present.
export const login2faSchema = z
  .object({
    challenge: z.string().min(1, 'Sitzung abgelaufen. Bitte melde dich erneut an.'),
    code: totpCodeSchema.optional(),
    recoveryCode: z.string().trim().min(4).max(40).optional(),
  })
  .refine((d) => !!d.code || !!d.recoveryCode, {
    message: 'Bitte gib deinen Code ein.',
  });

// Global message search (home screen).
export const searchQuerySchema = z
  .string()
  .trim()
  .min(2, 'Bitte gib mindestens 2 Zeichen ein.')
  .max(120, 'Die Suche ist zu lang.');

// Link-preview lookups (0.28.0). Shape-only validation here; the SSRF host
// checks live in linkPreview.js (they need DNS and so are async).
export const linkPreviewUrlSchema = z
  .string()
  .trim()
  .min(1, 'Bitte gib eine Adresse ein.')
  .max(2048, 'Diese Adresse ist zu lang.')
  .url('Diese Adresse ist ungültig.')
  .refine((u) => /^https?:\/\//i.test(u), 'Nur http- und https-Links werden unterstützt.');

// An official message an admin sends into a user's "Ping Team" channel — either
// to one user or broadcast to everyone. Plain text only (no caller-supplied
// attachment to keep the channel simple and trustworthy).
export const officialMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine Nachricht ein.')
    .max(2000, 'Die Nachricht ist zu lang.'),
});

// ---- anonymous client diagnostics (opt-in) --------------------------------
// Deliberately strict + tightly bounded: these endpoints are unauthenticated,
// so caps on counts and string lengths are the main abuse defence (alongside
// the /api rate limiter and the 64 kB body limit). No PII is accepted.
const appField = z.enum(['web', 'android', 'windows', 'ios']).default('web');

export const telemetrySchema = z.object({
  aid: z.string().trim().max(64).optional(),
  app: appField,
  ua: z.string().max(200).optional(),
  events: z
    .array(z.object({
      name: z.string().trim().min(1).max(60),
      t: z.number().int().nonnegative().optional(),
    }))
    .max(50),
});

export const clientErrorSchema = z.object({
  aid: z.string().trim().max(64).optional(),
  app: appField,
  appVersion: z.string().trim().max(40).optional(),
  context: z.string().trim().max(40).optional(),
  message: z.string().trim().max(500).optional(),
  stack: z.string().max(4000).optional(),
  ua: z.string().max(200).optional(),
  url: z.string().max(300).optional(),
});

// Anonymous, opt-in device-fleet snapshot. `metrics` is a flat map of
// metric→bucket *labels* (coarse strings, never raw readings), e.g.
// { android: '14', net: 'wifi', battery: '40-59', ram: '6-8' }. Both keys and
// values are short strings; the record-side also re-caps them. No PII.
const metricLabel = z.string().trim().min(1).max(24);
export const deviceStatsSchema = z.object({
  aid: z.string().trim().max(64).optional(),
  app: appField,
  metrics: z.record(metricLabel, metricLabel).default({}),
});

// An official status ("story") an admin posts so every user sees it.
export const adminStatusSchema = z
  .object({
    type: z.enum(['text', 'image', 'video']).optional(),
    body: z.string().max(700, 'Der Status ist zu lang.').optional(),
    attachment: attachmentSchema.optional(),
    bgColor: avatarColorSchema.optional(),
  })
  .refine(
    (d) => {
      const t = d.type || 'text';
      return t === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment;
    },
    { message: 'Ein Status braucht Text, ein Bild oder ein Video.' }
  );

// A single emoji reaction. We keep it short (an emoji can be several code units
// with ZWJ/skin-tone modifiers) but never a long string.
export const reactionSchema = z.object({
  emoji: z.string().trim().min(1, 'Emoji fehlt.').max(16, 'Ungültiges Emoji.'),
});

// A poll: a question plus 2-12 answer options; `multi` allows several picks.
export const pollCreateSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine Frage ein.')
    .max(300, 'Die Frage ist zu lang.'),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Leere Antwortoptionen gehen nicht.')
        .max(100, 'Eine Antwortoption ist zu lang.')
    )
    .min(2, 'Eine Umfrage braucht mindestens 2 Antworten.')
    .max(12, 'Höchstens 12 Antworten pro Umfrage.'),
  multi: z.boolean().optional(),
  // 0.37.0 "Feinschliff": quiz mode — the index of the single correct answer.
  // null/omitted = a plain poll. A quiz is always single-choice.
  correct: z.number().int().min(0).max(11).nullable().optional(),
});

// Voting toggles one option by its index.
export const pollVoteSchema = z.object({
  option: z.number().int().min(0).max(11),
});

// ---- Pläne & Aufgaben (0.33.0) --------------------------------------------

// An event ("Termin"): a title, a start time (epoch-ms, must be in the future),
// optional description/location and an optional pre-start reminder in minutes.
export const eventCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Bitte gib dem Termin einen Titel.')
    .max(140, 'Der Titel ist zu lang.'),
  description: z.string().trim().max(2000, 'Die Beschreibung ist zu lang.').optional().default(''),
  location: z.string().trim().max(200, 'Der Ort ist zu lang.').optional().default(''),
  startAt: z
    .number()
    .int('Ungültige Startzeit.')
    .refine((t) => t > Date.now() - 60_000, 'Der Termin liegt in der Vergangenheit.')
    .refine((t) => t < Date.now() + 5 * 365 * 86400_000, 'Der Termin liegt zu weit in der Zukunft.'),
  // 0 = no reminder; otherwise nudge this many minutes before the start.
  remindMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60, 'Erinnerung höchstens 7 Tage vorher.')
    .optional()
    .default(0),
  // 0.34.0: recurrence. '' = one-off; otherwise repeat daily/weekly/monthly.
  recur: z.enum(['', 'daily', 'weekly', 'monthly']).optional().default(''),
});

// RSVP to an event: going / maybe / declined, or null to withdraw.
export const rsvpSchema = z.object({
  status: z.enum(['going', 'maybe', 'declined']).nullable(),
});

// A task list ("Aufgabe"): a title plus 1-50 checklist items.
export const taskListCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Bitte gib der Liste einen Titel.')
    .max(140, 'Der Titel ist zu lang.'),
  items: z
    .array(
      z.string().trim().min(1, 'Leere Aufgaben gehen nicht.').max(200, 'Eine Aufgabe ist zu lang.')
    )
    .min(1, 'Eine Liste braucht mindestens eine Aufgabe.')
    .max(50, 'Höchstens 50 Aufgaben pro Liste.'),
});

// Append a single item to an existing task list.
export const taskItemAddSchema = z.object({
  text: z.string().trim().min(1, 'Leere Aufgaben gehen nicht.').max(200, 'Eine Aufgabe ist zu lang.'),
});

// Toggle an item's done state.
export const taskItemToggleSchema = z.object({
  done: z.boolean(),
});

// ---- 0.35.0 "Ausdruck & Werkbank" -----------------------------------------

// Share a contact card. Normally you share a Ping account (userId); the server
// snapshots that account's public profile. An optional note rides along.
export const contactCardSchema = z.object({
  userId: z.string().trim().min(1, 'Kein Kontakt ausgewählt.').max(64),
  note: z.string().trim().max(280, 'Die Notiz ist zu lang.').optional().default(''),
});

// Share a code snippet. Language/filename are cosmetic labels; the body is the
// source. We cap it generously — this is a chat, not a paste bin.
export const codeSnippetSchema = z.object({
  code: z
    .string()
    .min(1, 'Der Code ist leer.')
    .max(20000, 'Das Snippet ist zu lang (max. 20.000 Zeichen).')
    // Keep the source verbatim (indentation matters), but reject a blank snippet.
    .refine((s) => s.trim().length > 0, 'Der Code ist leer.'),
  language: z
    .string()
    .trim()
    .max(24, 'Der Sprachname ist zu lang.')
    .regex(/^[a-zA-Z0-9+#.\- ]*$/, 'Ungültiger Sprachname.')
    .optional()
    .default(''),
  filename: z.string().trim().max(120, 'Der Dateiname ist zu lang.').optional().default(''),
});

// ---- 0.36.0 "Zusammen" ----------------------------------------------------

// A shared expense ("Geteilte Kasse"). The amount is in minor units (cents); the
// split is either equal among the chosen participants or a list of explicit
// shares that must add up to the total — the route enforces that sum so the
// ledger always balances.
export const expenseCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Bitte gib der Ausgabe einen Titel.')
      .max(140, 'Der Titel ist zu lang.'),
    // 1 cent … 100 million (1,000,000.00) — generous, but not absurd.
    amountCents: z
      .number()
      .int('Ungültiger Betrag.')
      .min(1, 'Der Betrag muss größer als 0 sein.')
      .max(100_000_000_00, 'Der Betrag ist zu groß.'),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Ungültige Währung.')
      .optional()
      .default('EUR'),
    // Who fronted the money. Omitted ⇒ the creator paid.
    payerId: z.string().trim().max(64).optional().default(''),
    // 'equal' splits the total evenly across `participants`; 'custom' uses the
    // explicit per-user `shares`.
    split: z.enum(['equal', 'custom']).optional().default('equal'),
    participants: z.array(z.string().trim().min(1).max(64)).max(100).optional().default([]),
    shares: z
      .array(
        z.object({
          userId: z.string().trim().min(1).max(64),
          shareCents: z.number().int().min(0).max(100_000_000_00),
        })
      )
      .max(100)
      .optional()
      .default([]),
  })
  .refine((d) => d.split !== 'equal' || d.participants.length >= 1, {
    message: 'Wähle mindestens eine Person zum Teilen.',
    path: ['participants'],
  })
  .refine((d) => d.split !== 'custom' || d.shares.length >= 1, {
    message: 'Gib mindestens einen Anteil an.',
    path: ['shares'],
  });

// Record a settlement: I (or `fromUserId`) pay `toUserId` to clear a debt.
export const settleSchema = z.object({
  toUserId: z.string().trim().min(1, 'Kein Empfänger gewählt.').max(64),
  amountCents: z
    .number()
    .int('Ungültiger Betrag.')
    .min(1, 'Der Betrag muss größer als 0 sein.')
    .max(100_000_000_00, 'Der Betrag ist zu groß.'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Ungültige Währung.')
    .optional()
    .default('EUR'),
});

// An availability poll ("Terminfindung"): a title, an optional location and
// 2–8 candidate start times (epoch-ms, all in the future).
export const availPollCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Bitte gib der Terminfindung einen Titel.')
    .max(140, 'Der Titel ist zu lang.'),
  location: z.string().trim().max(200, 'Der Ort ist zu lang.').optional().default(''),
  options: z
    .array(
      z
        .number()
        .int('Ungültige Zeit.')
        .refine((t) => t > Date.now() - 60_000, 'Ein Vorschlag liegt in der Vergangenheit.')
        .refine((t) => t < Date.now() + 5 * 365 * 86400_000, 'Ein Vorschlag liegt zu weit in der Zukunft.')
    )
    .min(2, 'Mindestens zwei Vorschläge.')
    .max(8, 'Höchstens acht Vorschläge.'),
});

// Vote on one availability slot: yes / maybe / no, or null to withdraw.
export const availVoteSchema = z.object({
  optionId: z.string().trim().min(1).max(64),
  vote: z.enum(['yes', 'maybe', 'no']).nullable(),
});

// Organiser locks the winning slot, spawning a real event from it.
export const availLockSchema = z.object({
  optionId: z.string().trim().min(1, 'Kein Termin gewählt.').max(64),
  // Optional pre-start reminder for the spawned event (minutes), 0 = none.
  remindMinutes: z.number().int().min(0).max(7 * 24 * 60).optional().default(0),
});

// Disappearing-messages timer: off (0) or 1 minute … 1 year.
export const expireTimerSchema = z.object({
  seconds: z
    .number()
    .int()
    .min(0, 'Ungültige Dauer.')
    .max(365 * 86400, 'Höchstens 1 Jahr.')
    .refine((s) => s === 0 || s >= 60, 'Mindestens 1 Minute.'),
});

// ---- Ordnung & Ausdruck (0.27.0) -------------------------------------------

// A per-chat draft. Capped at the same length as a message; whitespace-only is
// treated as "clear the draft" by the repo, so an empty string is valid.
export const draftSchema = z.object({
  text: z.string().max(8000, 'Der Entwurf ist zu lang.').default(''),
});

// A chat folder: a short name, an optional single-emoji icon and a sort weight.
export const folderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Bitte gib einen Namen ein.')
    .max(40, 'Der Name ist zu lang.'),
  emoji: z.string().trim().max(16, 'Ungültiges Emoji.').default(''),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});

// Setting a folder's chats: a (de-duplicated by the repo) list of chat ids.
export const folderChatsSchema = z.object({
  chatIds: z
    .array(z.string().trim().min(1).max(64))
    .max(1000, 'Zu viele Chats.')
    .default([]),
});

// ---- Newsroom + changelog (public content) ---------------------------------

// A cover image / link: either one of our own uploads or an absolute https URL.
const coverSchema = z
  .string()
  .trim()
  .max(512)
  .refine(
    (v) => v === '' || v.startsWith('/api/uploads/') || /^https:\/\//.test(v),
    'Ungültige Bild-URL.'
  );

// A newsroom article or a changelog entry. `kind` decides which extra fields
// matter (category for news; version + tag for changelog) but all are optional.
export const postCreateSchema = z.object({
  kind: z.enum(['news', 'changelog']),
  title: z
    .string()
    .trim()
    .min(1, 'Bitte gib einen Titel ein.')
    .max(140, 'Der Titel ist zu lang.'),
  slug: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(400, 'Die Kurzbeschreibung ist zu lang.').optional(),
  body: z.string().max(20000, 'Der Text ist zu lang.').optional(),
  category: z.string().trim().max(40).optional(),
  version: z.string().trim().max(40).optional(),
  tag: z.enum(['feature', 'improvement', 'fix', 'security', '']).optional(),
  cover: coverSchema.optional(),
  author: z.string().trim().max(60).optional(),
  pinned: z.boolean().optional(),
  published: z.boolean().optional(),
});

// Editing: every field optional, but at least one must be present.
export const postUpdateSchema = postCreateSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nichts zu ändern.' });

export const pushTokenSchema = z.object({
  token: z.string().trim().min(1, 'Token fehlt.').max(4096),
  platform: z.enum(['android', 'ios', 'web']).optional(),
});

// A W3C Push API subscription as serialized by the browser: the push-service
// endpoint URL plus the two encryption keys (base64url) the server seals each
// payload with. Sizes are generously bounded to reject obvious junk only.
export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url('Ungültiger Push-Endpoint.').max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(512),
    auth: z.string().trim().min(1).max(256),
  }),
});

// ---- Erinnerung & Schnellzugriff (0.29.0) ----------------------------------

// A message reminder. remindAt is an absolute epoch-ms timestamp that must be in
// the future (a small skew is tolerated) and no more than a year out; an
// optional note lets the user record *why* they want the nudge.
export const reminderCreateSchema = z.object({
  remindAt: z
    .number()
    .int('Ungültiger Zeitpunkt.')
    .refine((t) => t > Date.now() - 60_000, 'Der Zeitpunkt liegt in der Vergangenheit.')
    .refine((t) => t < Date.now() + 366 * 86400_000, 'Höchstens 1 Jahr im Voraus.'),
  note: z.string().trim().max(500, 'Die Notiz ist zu lang.').optional().default(''),
  // 0.37.0 "Feinschliff": a recurring reminder re-schedules itself when it fires.
  recur: z.enum(['', 'daily', 'weekly']).optional().default(''),
});

// 0.37.0 "Feinschliff": a folder's keyword auto-sort rule. kind 'all' clears it.
export const folderRuleSchema = z.object({
  kind: z.enum(['all', 'keyword']),
  keyword: z.string().trim().max(60, 'Das Stichwort ist zu lang.').optional().default(''),
});

// 0.37.0 "Feinschliff": per-chat auto-translation target ('' = off). A short
// ISO-639-1-ish language code, or empty to disable.
export const autoTranslateSchema = z.object({
  lang: z
    .string()
    .trim()
    .max(8, 'Ungültiger Sprachcode.')
    .regex(/^[a-zA-Z-]*$/, 'Ungültiger Sprachcode.')
    .optional()
    .default(''),
});

// A quick reply (canned response): required body, optional short "/shortcut".
// The shortcut is normalised to lowercase word-chars by the repo's consumers;
// here we only bound it and forbid whitespace so "/gn8" stays a single token.
export const quickReplyCreateSchema = z.object({
  shortcut: z
    .string()
    .trim()
    .max(24, 'Das Kürzel ist zu lang.')
    .refine((v) => v === '' || !/\s/.test(v), 'Das Kürzel darf keine Leerzeichen enthalten.')
    .optional()
    .default(''),
  text: z
    .string()
    .trim()
    .min(1, 'Bitte gib einen Text ein.')
    .max(8000, 'Der Text ist zu lang.'),
});

// Editing a quick reply: every field optional, but at least one must be present.
export const quickReplyUpdateSchema = z
  .object({
    shortcut: z
      .string()
      .trim()
      .max(24, 'Das Kürzel ist zu lang.')
      .refine((v) => v === '' || !/\s/.test(v), 'Das Kürzel darf keine Leerzeichen enthalten.')
      .optional(),
    text: z.string().trim().min(1, 'Bitte gib einen Text ein.').max(8000, 'Der Text ist zu lang.').optional(),
    sort: z.number().int().min(0).max(9999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nichts zu ändern.' });

// ---- Finden & Fokus (0.30.0) -----------------------------------------------

// Focus mode + quiet hours. Every field is optional (PATCH-style) but at least
// one must be present. focusUntil is an absolute epoch-ms expiry (0 turns the
// manual toggle off); quiet times are minutes-of-day (0–1439); quietDays is a
// 7-bit mask (bit 0 = Monday). autoReply is the one-time canned DM reply.
const minutesOfDay = z.number().int().min(0).max(1439);
export const focusSchema = z
  .object({
    focusUntil: z
      .number()
      .int()
      .min(0)
      .max(Date.now() + 366 * 86400_000, 'Höchstens 1 Jahr im Voraus.')
      .optional(),
    quietEnabled: z.boolean().optional(),
    quietStart: minutesOfDay.optional(),
    quietEnd: minutesOfDay.optional(),
    quietDays: z.number().int().min(0).max(127).optional(),
    autoReply: z.string().trim().max(500, 'Die Auto-Antwort ist zu lang.').optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nichts zu ändern.' });

// ---- „Alles" (0.34.0) ------------------------------------------------------

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

// A threaded reply: plain text under a root message.
export const threadReplySchema = z.object({
  body: z.string().trim().min(1, 'Leere Nachricht.').max(8000, 'Die Nachricht ist zu lang.'),
});

// Start a live-location share: position + a duration (minutes) it stays live.
export const liveLocationStartSchema = z.object({
  lat,
  lng,
  accuracy: z.number().min(0).max(100000).optional(),
  heading: z.number().min(0).max(360).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional().default(60),
});
// A position update for an active share.
export const liveLocationUpdateSchema = z.object({
  lat,
  lng,
  accuracy: z.number().min(0).max(100000).optional(),
  heading: z.number().min(0).max(360).optional(),
});

// Schedule a call: a title, audio/video, a future start, optional pre-reminder.
export const scheduledCallSchema = z.object({
  title: z.string().trim().max(140, 'Der Titel ist zu lang.').optional().default(''),
  video: z.boolean().optional().default(false),
  startAt: z
    .number()
    .int('Ungültige Startzeit.')
    .refine((t) => t > Date.now() - 60_000, 'Der Anruf liegt in der Vergangenheit.')
    .refine((t) => t < Date.now() + 365 * 86400_000, 'Zu weit in der Zukunft.'),
  remindMinutes: z.number().int().min(0).max(7 * 24 * 60).optional().default(10),
});

// A kanban board: a title plus 1-8 initial columns.
export const boardCreateSchema = z.object({
  title: z.string().trim().min(1, 'Bitte gib dem Board einen Titel.').max(140, 'Der Titel ist zu lang.'),
  columns: z
    .array(z.string().trim().min(1).max(60))
    .min(1, 'Mindestens eine Spalte.')
    .max(8, 'Höchstens 8 Spalten.')
    .optional(),
});
export const boardColumnSchema = z.object({
  title: z.string().trim().min(1, 'Leere Spalte geht nicht.').max(60, 'Die Spalte ist zu lang.'),
});
export const boardCardSchema = z.object({
  columnId: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1, 'Leere Karte geht nicht.').max(500, 'Die Karte ist zu lang.'),
});
export const boardCardMoveSchema = z.object({
  columnId: z.string().trim().min(1).max(64),
  sort: z.number().int().min(0).max(100000).optional(),
});
export const boardCardEditSchema = z.object({
  text: z.string().trim().min(1, 'Leere Karte geht nicht.').max(500, 'Die Karte ist zu lang.'),
});

// Start a mini-game; make a move (cell index or column).
export const gameCreateSchema = z.object({
  kind: z.enum(['tictactoe', 'connect4']),
});
export const gameMoveSchema = z.object({
  cell: z.number().int().min(0).max(41),
});

// Send a sticker by id (the bytes already live as an upload behind the sticker).
export const stickerSendSchema = z.object({
  stickerId: z.string().trim().min(1).max(64),
  replyTo: z.string().trim().max(64).nullable().optional(),
});

// Collaborative group notes.
export const noteCreateSchema = z.object({
  title: z.string().trim().min(1, 'Bitte gib einen Titel ein.').max(140, 'Der Titel ist zu lang.'),
  body: z.string().trim().max(20000, 'Die Notiz ist zu lang.').optional().default(''),
});
export const noteUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    body: z.string().trim().max(20000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nichts zu ändern.' });

// Per-chat appearance (wallpaper preset/upload + accent hex).
export const chatAppearanceSchema = z
  .object({
    wallpaper: z.string().trim().max(512).nullable().optional(),
    accent: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'Ungültige Farbe.').nullable().optional(),
  })
  .refine((d) => 'wallpaper' in d || 'accent' in d, { message: 'Nichts zu ändern.' });

// Per-chat default disappearing timer (seconds; 0 = off, else ≥ 60).
export const defaultTtlSchema = z.object({
  seconds: z.number().int().min(0).max(365 * 86400).refine((s) => s === 0 || s >= 60, 'Mindestens 1 Minute.'),
});

// Webhooks / bots.
export const webhookCreateSchema = z.object({
  name: z.string().trim().min(1, 'Bitte gib einen Namen ein.').max(80, 'Der Name ist zu lang.'),
  direction: z.enum(['in', 'out']).optional().default('in'),
  url: z.string().trim().url('Ungültige URL.').max(512).optional(),
});
// Body posted to an incoming webhook to fan a message into its chat.
export const webhookPostSchema = z.object({
  text: z.string().trim().min(1, 'Leere Nachricht.').max(4000, 'Zu lang.'),
  name: z.string().trim().max(80).optional(),
});

// Opt-in E2EE: publish a public identity key; flip a DM's encryption on/off.
export const e2eeIdentitySchema = z.object({
  publicKey: z.string().trim().min(16, 'Ungültiger Schlüssel.').max(2048),
});
export const e2eeToggleSchema = z.object({
  enabled: z.boolean(),
});

// Inline translation: source text + a target language code.
export const translateSchema = z.object({
  text: z.string().trim().min(1, 'Nichts zu übersetzen.').max(8000, 'Zu lang.'),
  target: z.string().trim().min(2).max(8),
  source: z.string().trim().min(2).max(8).optional(),
});

// "Now playing" rich status.
export const nowPlayingSchema = z.object({
  title: z.string().trim().min(1, 'Titel fehlt.').max(200),
  artist: z.string().trim().max(200).optional().default(''),
  url: z.string().trim().url('Ungültige URL.').max(512).optional(),
  cover: coverSchema.optional(),
});

// Sticker pack management.
export const stickerPackCreateSchema = z.object({
  name: z.string().trim().min(1, 'Bitte gib einen Namen ein.').max(60, 'Der Name ist zu lang.'),
});
export const stickerAddSchema = z.object({
  uploadId: z.string().trim().min(1).max(64),
  emoji: z.string().trim().max(16).optional().default(''),
});

// Approve/deny a pending login from a trusted device.
export const approvalDecisionSchema = z.object({
  approve: z.boolean(),
});

// Parse with a schema and throw a structured 400-style error on failure.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const err = new Error(first?.message || 'Ungültige Eingabe.');
    err.status = 400;
    throw err;
  }
  return result.data;
}
