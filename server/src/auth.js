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
  return jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.tokenTtl,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
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
  req.user = user;
  next();
}
