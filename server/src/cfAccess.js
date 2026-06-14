import jwt from 'jsonwebtoken';
import { config } from './config.js';

// Origin-side verification of the JWT that Cloudflare Access attaches to every
// request it has authenticated (header `Cf-Access-Jwt-Assertion`). The team's
// public signing certificates are fetched from its certs endpoint and cached
// briefly. When CF Access isn't configured (no CF_ACCESS_* env), the middleware
// is a no-op, so dev / tests / self-hosted setups are unaffected.

const CERT_TTL_MS = 60 * 60 * 1000; // refresh signing certs hourly
let certCache = { at: 0, byKid: new Map() };

async function fetchCerts(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const json = await res.json();
  const byKid = new Map();
  for (const c of json.public_certs || []) {
    if (c && c.kid && c.cert) byKid.set(c.kid, c.cert);
  }
  return byKid;
}

async function getCerts(teamDomain, force = false) {
  if (!force && Date.now() - certCache.at < CERT_TTL_MS && certCache.byKid.size) {
    return certCache.byKid;
  }
  const byKid = await fetchCerts(teamDomain);
  certCache = { at: Date.now(), byKid };
  return byKid;
}

/**
 * Verify a Cloudflare Access JWT. Resolves true when valid — or when CF Access
 * isn't configured at all (feature off). Never throws.
 */
export async function verifyAccessJwt(token) {
  const cf = config.cfAccess;
  if (!cf) return true; // feature disabled
  if (!token || typeof token !== 'string') return false;

  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) return false;

  let cert;
  try {
    let certs = await getCerts(cf.teamDomain);
    cert = certs.get(kid);
    if (!cert) {
      // Unknown kid — Cloudflare may have rotated keys; refresh once.
      certs = await getCerts(cf.teamDomain, true);
      cert = certs.get(kid);
    }
  } catch {
    return false;
  }
  if (!cert) return false;

  try {
    jwt.verify(token, cert, {
      algorithms: ['RS256'],
      audience: cf.aud,
      issuer: `https://${cf.teamDomain}`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Express middleware enforcing a valid Cloudflare Access JWT. No-op when CF
 * Access isn't configured.
 */
export function requireCfAccess(req, res, next) {
  if (!config.cfAccess) return next();
  const token = req.headers['cf-access-jwt-assertion'];
  verifyAccessJwt(token)
    .then((ok) =>
      ok ? next() : res.status(403).json({ error: 'Cloudflare Access erforderlich.' })
    )
    .catch(() => res.status(403).json({ error: 'Cloudflare Access erforderlich.' }));
}
