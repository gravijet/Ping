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
  // RIFF....WEBP (also covers animated WebP)
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // GIF87a / GIF89a — enables animated profile & group pictures.
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
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

// Profile backgrounds ("banners") live in the same store under a distinct key
// so they can never collide with the round avatar.
function bannerPath(userId) {
  return path.join(dir, `${userId}.banner.bin`);
}

export function saveBanner(userId, buf) {
  fs.writeFileSync(bannerPath(userId), buf);
}

export function readBanner(userId) {
  try {
    return fs.readFileSync(bannerPath(userId));
  } catch {
    return null;
  }
}

export function deleteBanner(userId) {
  try {
    fs.unlinkSync(bannerPath(userId));
  } catch {
    /* already gone */
  }
}
