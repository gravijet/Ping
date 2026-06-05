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

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Leere Nachrichten kannst du nicht senden.')
  .max(4000, 'Die Nachricht ist zu lang (max. 4000 Zeichen).');

// Start a direct chat by user id, phone number or email.
export const directChatSchema = z
  .object({
    userId: z.string().min(1).optional(),
    phone: phoneInputSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((d) => d.userId || d.phone || d.email, {
    message: 'Gib eine Nummer, E-Mail oder einen Kontakt an.',
  });

export const lookupSchema = z
  .object({
    phone: phoneInputSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((d) => d.phone || d.email, {
    message: 'Gib eine Nummer oder E-Mail an.',
  });

export const matchSchema = z.object({
  phones: z.array(z.string()).max(config.maxContactMatch).optional(),
  emails: z.array(z.string()).max(config.maxContactMatch).optional(),
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
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.password !== undefined ||
      d.isAdmin !== undefined,
    { message: 'Nichts zu ändern.' }
  );

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
