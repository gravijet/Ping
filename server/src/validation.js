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
  .max(140, 'Über mich darf höchstens 140 Zeichen haben.');

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

// SMS one-time-code verification.
export const requestCodeSchema = z.object({ phone: phoneInputSchema });
export const verifyCodeSchema = z.object({
  phone: phoneInputSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Bitte gib den Code aus der SMS ein.'),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  about: aboutSchema.optional(),
  avatarColor: avatarColorSchema.optional(),
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
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.password !== undefined ||
      d.isAdmin !== undefined ||
      d.email !== undefined ||
      d.about !== undefined ||
      d.disabled !== undefined,
    { message: 'Nichts zu ändern.' }
  );

export const adminBroadcastSchema = z.object({
  title: z.string().trim().max(80).optional(),
  body: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine Nachricht ein.')
    .max(2000, 'Die Durchsage ist zu lang.'),
});

export const messageStorageSchema = z.object({
  mode: z.enum(['server', 'local']),
});

// A single emoji reaction. We keep it short (an emoji can be several code units
// with ZWJ/skin-tone modifiers) but never a long string.
export const reactionSchema = z.object({
  emoji: z.string().trim().min(1, 'Emoji fehlt.').max(16, 'Ungültiges Emoji.'),
});

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
