import jwt from 'jsonwebtoken';
import { config } from './config.js';

// Verifies Firebase **phone-auth** ID tokens so the server can trust that a
// registering number really belongs to the device that signed in. We don't pull
// in the Firebase Admin SDK (and need no service-account key): a Firebase ID
// token is a normal RS256 JWT signed by Google, so we verify it against Google's
// public x509 certs and check the standard Firebase claims for our project.

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/user@example.invalid';

// Cache the public certs and respect the response's Cache-Control max-age.
let certCache = { keys: null, exp: 0 };

async function googleCerts() {
  if (certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error('Konnte Google-Zertifikate nicht laden.');
  const keys = await res.json();
  const cc = res.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/.exec(cc);
  const ttlMs = (m ? Number(m[1]) : 3600) * 1000;
  certCache = { keys, exp: Date.now() + ttlMs };
  return keys;
}

/// Verify [idToken] and return its decoded payload (which carries `phone_number`
/// for phone-auth tokens). Throws on any signature/claim/expiry problem.
export async function verifyFirebaseIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20) {
    throw new Error('Kein Token.');
  }
  const projectId = config.firebaseProjectId;
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header || decoded.header.alg !== 'RS256' || !decoded.header.kid) {
    throw new Error('Ungültiges Token-Format.');
  }
  const certs = await googleCerts();
  const cert = certs[decoded.header.kid];
  if (!cert) throw new Error('Unbekannter Token-Schlüssel.');
  // jsonwebtoken checks the signature, audience, issuer and expiry for us.
  const payload = jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  if (!payload.sub) throw new Error('Token ohne Subjekt.');
  return payload;
}
