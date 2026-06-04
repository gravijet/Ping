import { z } from 'zod';

// Friendly German validation messages — these surface directly in the app.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Der Benutzername braucht mindestens 3 Zeichen.')
  .max(24, 'Der Benutzername darf höchstens 24 Zeichen haben.')
  .regex(
    /^[a-zA-Z0-9_.]+$/,
    'Erlaubt sind Buchstaben, Zahlen, Punkt und Unterstrich.'
  );

export const passwordSchema = z
  .string()
  .min(6, 'Das Passwort braucht mindestens 6 Zeichen.')
  .max(200, 'Das Passwort ist zu lang.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte gib einen Namen ein.')
  .max(40, 'Der Name darf höchstens 40 Zeichen haben.');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Bitte gib deinen Benutzernamen ein.'),
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  about: z.string().trim().max(140, 'Über mich darf höchstens 140 Zeichen haben.').optional(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Ungültige Farbe.')
    .optional(),
});

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Leere Nachrichten kannst du nicht senden.')
  .max(4000, 'Die Nachricht ist zu lang (max. 4000 Zeichen).');

export const createDirectChatSchema = z.object({
  userId: z.string().min(1),
});

export const createGroupChatSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Bitte gib der Gruppe einen Namen.')
    .max(40, 'Der Gruppenname darf höchstens 40 Zeichen haben.'),
  memberIds: z.array(z.string().min(1)).max(256).optional(),
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
