import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(user) {
  // `tv` (token version) pins the session to the account's current token_epoch.
  // Bumping the epoch ("überall abmelden") invalidates every token signed under
  // the old value. Old tokens predating this field carry no `tv`; requireAuth
  // treats a missing `tv` as 0, matching a fresh account's epoch, so a deploy
  // never logs anyone out.
  return jwt.sign(
    { sub: user.id, phone: user.phone, tv: user.token_epoch || 0 },
    config.jwtSecret,
    { expiresIn: config.tokenTtl }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// A short-lived token issued after a correct password when the account has 2FA
// enabled. It proves "step 1 passed" without granting a session; the holder
// must still post a valid TOTP/recovery code to /auth/login/2fa to exchange it
// for a real token. Deliberately brief so a stolen challenge is near-useless.
export function signTwoFactorChallenge(userId) {
  return jwt.sign({ sub: userId, purpose: '2fa_challenge' }, config.jwtSecret, {
    expiresIn: '5m',
  });
}

/** Returns the user id for a valid, unexpired 2FA challenge token, else null. */
export function verifyTwoFactorChallenge(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload?.purpose === '2fa_challenge' ? payload.sub : null;
  } catch {
    return null;
  }
}

// A short-lived token proving the holder verified [phone] via the SMS OTP flow.
// Registration accepts it as proof of phone ownership (an alternative to the
// Firebase ID token).
export function signPhoneToken(phone) {
  return jwt.sign({ purpose: 'phone_verify', phone }, config.jwtSecret, {
    expiresIn: '20m',
  });
}

// Returns the verified phone number for a valid phone-verify token, else null.
export function verifyPhoneToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload?.purpose === 'phone_verify' ? payload.phone : null;
  } catch {
    return null;
  }
}

const findUser = db.prepare('SELECT * FROM users WHERE id = ?');

// Express middleware: requires a valid Bearer token and loads the user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Du bist nicht angemeldet.' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res
      .status(401)
      .json({ error: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' });
  }
  const user = findUser.get(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'Dieses Konto existiert nicht mehr.' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: 'Dieses Konto wurde gesperrt.' });
  }
  // Session epoch: a token is only valid while its `tv` matches the account's
  // current token_epoch. "Überall abmelden" bumps the epoch, so older tokens
  // (including this one if it was issued before the bump) stop working.
  if ((payload.tv ?? 0) !== (user.token_epoch ?? 0)) {
    return res
      .status(401)
      .json({ error: 'Diese Sitzung wurde beendet. Bitte melde dich erneut an.' });
  }
  req.user = user;
  next();
}

// Gate for the admin API. Two ways in:
//   1. The shared admin token (X-Admin-Token), used by the web portal.
//   2. A signed-in user whose account has is_admin set, used by the in-app
//      admin panel — so admins manage Ping without a separate secret.
export function requireAdmin(req, res, next) {
  const provided = (req.headers['x-admin-token'] || '').toString();
  if (config.adminToken && provided) {
    const a = Buffer.from(provided);
    const b = Buffer.from(config.adminToken);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  const user = payload ? findUser.get(payload.sub) : null;
  if (user && user.is_admin && !user.disabled) {
    req.user = user;
    return next();
  }

  if (!config.adminToken) {
    return res.status(503).json({ error: 'Das Admin-Portal ist nicht aktiviert.' });
  }
  return res.status(401).json({ error: 'Kein Admin-Zugriff.' });
}
