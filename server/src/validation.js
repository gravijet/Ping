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
    body: z.string().max(4000, 'Die Nachricht ist zu lang.').optional(),
    type: z.enum(mediaTypes).optional(),
    attachment: attachmentSchema.optional(),
    replyTo: z.string().min(1).optional(),
  })
  .refine(
    (d) => {
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

// Per-account privacy switches (extend here as more arrive).
export const privacySchema = z.object({
  showLastSeen: z.boolean(),
});

// Global message search (home screen).
export const searchQuerySchema = z
  .string()
  .trim()
  .min(2, 'Bitte gib mindestens 2 Zeichen ein.')
  .max(120, 'Die Suche ist zu lang.');

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
});

// Voting toggles one option by its index.
export const pollVoteSchema = z.object({
  option: z.number().int().min(0).max(11),
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
