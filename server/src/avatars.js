import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const dir = config.uploadsDir;
fs.mkdirSync(dir, { recursive: true });

// Avatars are keyed by user id; the mime lives in the DB, so we keep a single
// file per user regardless of format.
function avatarPath(userId) {
  return path.join(dir, `${userId}.bin`);
}

// Sniff the format from magic bytes so we never trust a client content-type.
export function detectImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function saveAvatar(userId, buf) {
  fs.writeFileSync(avatarPath(userId), buf);
}

export function readAvatar(userId) {
  try {
    return fs.readFileSync(avatarPath(userId));
  } catch {
    return null;
  }
}

export function deleteAvatar(userId) {
  try {
    fs.unlinkSync(avatarPath(userId));
  } catch {
    /* already gone */
  }
}
