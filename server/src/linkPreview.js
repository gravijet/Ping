// linkPreview.js — fetch and parse the OpenGraph/HTML metadata behind a URL so
// the client can show a rich preview card. Dependency-free: a capped fetch plus
// a small regex metadata scraper.
//
// SECURITY: this endpoint makes the *server* fetch an arbitrary user-supplied
// URL, which is a classic SSRF vector. Defences here:
//   - only http(s) is allowed,
//   - the hostname is DNS-resolved and every resolved address is checked against
//     private / loopback / link-local / ULA / cloud-metadata ranges,
//   - redirects are followed manually and each hop is re-validated,
//   - the response must be HTML and is read with a hard byte cap + timeout.
// (Known residual: a TOCTOU between our DNS check and undici's own connect-time
//  resolution. A custom dispatcher lookup would close it; acceptable here.)

import dns from 'node:dns/promises';
import net from 'node:net';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB is plenty for a <head>
const MAX_REDIRECTS = 4;
const USER_AGENT =
  'PingBot/1.0 (+https://example.invalid; link-preview)';

const MAX_TITLE = 200;
const MAX_DESC = 300;
const MAX_SITE = 80;
const MAX_URL = 1024;

/// True for any IP literal we must never connect to (RFC1918, loopback,
/// link-local incl. the 192.0.2.1 cloud-metadata address, CGNAT, ULA,
/// multicast/reserved). Unknown formats are treated as unsafe.
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved / broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return true;
    const mapped = x.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

function isBlockedHostname(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.home.arpa')
  );
}

/// Validate a single URL hop: must be http(s), a real public host. Throws an
/// Error (status 400) when the URL is malformed or points somewhere private.
/// Returns the parsed URL on success.
export async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw badUrl('Diese Adresse ist ungültig.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw badUrl('Nur http- und https-Links werden unterstützt.');
  }
  const host = u.hostname;
  if (!host || isBlockedHostname(host)) throw badUrl('Dieser Host ist nicht erreichbar.');

  // A bare IP literal: check it directly. Otherwise resolve and check every
  // address the name maps to (defends against names that point at private IPs).
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw badUrl('Dieser Host ist nicht erreichbar.');
    return u;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw badUrl('Dieser Host ist nicht erreichbar.');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw badUrl('Dieser Host ist nicht erreichbar.');
  }
  return u;
}

function badUrl(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// ---- HTML metadata parsing -------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, ent) => {
    const e = ent.toLowerCase();
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

function safeFromCodePoint(code) {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

function clean(s, max) {
  return decodeEntities(String(s || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Pull a single attribute value out of a tag's attribute string (quoted or not).
function attr(tag, name) {
  const m =
    tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i')) ||
    tag.match(new RegExp(`${name}\\s*=\\s*([^\\s"'>]+)`, 'i'));
  return m ? m[1] : null;
}

/// Scrape title/description/image/siteName out of an HTML document. Pure +
/// synchronous so it's trivially unit-testable. [baseUrl] resolves relative
/// image/icon paths. Returns a normalized object (image/desc may be empty);
/// returns null when there's nothing worth showing (no title at all).
export function parseMetadata(html, baseUrl) {
  const head = sliceHead(html);
  const meta = {};
  const tagRe = /<meta\b[^>]*>/gi;
  let t;
  while ((t = tagRe.exec(head))) {
    const tag = t[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (!key) continue;
    const content = attr(tag, 'content');
    if (content == null || meta[key] !== undefined) continue;
    meta[key] = content;
  }

  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = clean(
    meta['og:title'] || meta['twitter:title'] || (titleTag ? titleTag[1] : ''),
    MAX_TITLE
  );
  if (!title) return null;

  const description = clean(
    meta['og:description'] || meta['twitter:description'] || meta.description || '',
    MAX_DESC
  );

  const rawImage =
    meta['og:image:secure_url'] ||
    meta['og:image'] ||
    meta['twitter:image'] ||
    meta['twitter:image:src'] ||
    '';
  const image = resolveUrl(rawImage, baseUrl);

  let siteName = clean(meta['og:site_name'] || '', MAX_SITE);
  if (!siteName) {
    try {
      siteName = new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      siteName = '';
    }
  }

  return { title, description, image, siteName };
}

// Only scan the <head> (where metadata lives) when present — cheaper and avoids
// matching stray <meta> inside body content.
function sliceHead(html) {
  const s = String(html || '');
  const end = s.search(/<\/head>/i);
  return end > 0 ? s.slice(0, end) : s.slice(0, MAX_BODY_BYTES);
}

function resolveUrl(value, base) {
  if (!value) return '';
  try {
    const abs = new URL(value, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return '';
    return abs.toString().slice(0, MAX_URL);
  } catch {
    return '';
  }
}

// ---- Fetch -----------------------------------------------------------------

/// Fetch [rawUrl] and return a normalized preview object, or null when there's
/// no usable preview (non-HTML, no metadata, blocked host, network error). Never
/// throws for ordinary failures — the caller negative-caches a null. SSRF-unsafe
/// URLs return null here too (the route validates separately for a 400).
export async function fetchLinkPreview(rawUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await assertSafeUrl(current).catch(() => null);
      if (!safe) return null;
      const res = await fetch(safe, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'de,en;q=0.8',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        current = new URL(loc, safe).toString();
        continue;
      }
      if (!res.ok) return null;
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (!ctype.includes('html')) return null;
      const html = await readCapped(res);
      const meta = parseMetadata(html, current);
      if (!meta) return null;
      return { ...meta, finalUrl: current.slice(0, MAX_URL) };
    }
    return null; // too many redirects
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Read at most MAX_BODY_BYTES of the response body, then stop (we only need the
// <head>). Aborts the stream once the cap is hit so a huge page can't blow memory.
async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, MAX_BODY_BYTES).toString('utf8');
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8');
}
