import crypto from 'node:crypto';

// In-memory store for desktop device-linking ("scan a QR like WhatsApp Web").
// A pending link is short-lived (LINK_TTL_MS), single-use, and never touches the
// database — losing them on a server restart is fine because they expire in
// seconds anyway. The flow:
//   1. The desktop calls createLink() and shows a QR encoding only `code`.
//   2. The signed-in phone scans it and calls approve(code, user), which mints a
//      real session token for that user and attaches it to the link.
//   3. The desktop polls with its private (linkId, pollSecret) pair and claims
//      the token the moment the link is approved.
// The QR (which a bystander could photograph) carries only `code`, so the worst
// a leaked QR allows is approving the *scanner's own* account onto the desktop —
// the token is delivered solely to whoever holds `pollSecret` (the desktop).

const LINK_TTL_MS = 120_000; // 2 minutes
const links = new Map(); // linkId -> session

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function isExpired(link) {
  return Date.now() > link.expiresAt;
}

// Drop expired links so the map can't grow unbounded. Cheap to call on access.
function sweep() {
  const now = Date.now();
  for (const [id, link] of links) {
    if (now > link.expiresAt) links.delete(id);
  }
}

// Create a pending link. Returns the values the desktop needs: the public `code`
// (goes into the QR) plus the private `linkId`/`pollSecret` (kept by the desktop
// to claim the token later).
export function createLink() {
  sweep();
  const linkId = token(16);
  const link = {
    linkId,
    code: token(24),
    pollSecret: token(24),
    status: 'pending', // pending -> approved -> consumed
    userId: null,
    sessionToken: null,
    deviceLabel: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + LINK_TTL_MS,
  };
  links.set(linkId, link);
  return link;
}

function findByCode(code) {
  if (!code) return null;
  for (const link of links.values()) {
    if (link.code === code) return link;
  }
  return null;
}

// Called by the signed-in phone after scanning the QR. Attaches a freshly minted
// session token (provided by the caller via `mintToken`) to the link.
// Returns { ok } or { error } with a stable reason code.
export function approveLink(code, { userId, sessionToken, deviceLabel } = {}) {
  sweep();
  const link = findByCode(code);
  if (!link || isExpired(link)) return { error: 'expired' };
  if (link.status !== 'pending') return { error: 'used' };
  link.status = 'approved';
  link.userId = userId;
  link.sessionToken = sessionToken;
  link.deviceLabel = deviceLabel || null;
  return { ok: true };
}

// Called by the desktop while it waits, and once more to claim the token. Only
// the holder of the matching (linkId, pollSecret) can read the token, and the
// token can be claimed exactly once.
export function pollLink(linkId, pollSecret) {
  sweep();
  const link = links.get(linkId);
  if (!link) return { status: 'expired' };
  if (link.pollSecret !== pollSecret) return { status: 'expired' };
  if (isExpired(link)) {
    links.delete(linkId);
    return { status: 'expired' };
  }
  if (link.status === 'approved') {
    const sessionToken = link.sessionToken;
    const userId = link.userId;
    // Single-use: hand over the token and drop the link.
    links.delete(linkId);
    return { status: 'approved', sessionToken, userId };
  }
  return { status: 'pending' };
}

// Cancel a pending link (e.g. the desktop closed the QR screen).
export function cancelLink(linkId, pollSecret) {
  const link = links.get(linkId);
  if (link && link.pollSecret === pollSecret) {
    links.delete(linkId);
    return true;
  }
  return false;
}

// Test/maintenance helper.
export function _clearLinks() {
  links.clear();
}
