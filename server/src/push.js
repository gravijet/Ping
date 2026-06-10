import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { tokensForUsers, removePushToken } from './pushRepo.js';

// Firebase Cloud Messaging (HTTP v1) sender.
//
// Sending push needs OAuth2 access tokens minted from a Firebase service
// account (a JSON key file). We sign a short-lived JWT with the account's
// private key and exchange it for an access token — no Admin SDK dependency.
// If the key file is missing, push is simply disabled and every helper no-ops.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let serviceAccount = null;
try {
  if (fs.existsSync(config.firebaseServiceAccountPath)) {
    serviceAccount = JSON.parse(
      fs.readFileSync(config.firebaseServiceAccountPath, 'utf8')
    );
  }
} catch (e) {
  console.error('[push] Konnte Service-Account nicht laden:', e.message);
}

const projectId = serviceAccount?.project_id || config.firebaseProjectId;

export function pushEnabled() {
  return !!(serviceAccount && serviceAccount.client_email && serviceAccount.private_key);
}

if (!pushEnabled()) {
  console.log(
    '[push] FCM deaktiviert (keine firebase-service-account.json). ' +
      'Lege die Datei an, um Push-Benachrichtigungen zu aktivieren.'
  );
}

// ---- OAuth2 access token (cached until shortly before it expires) ----------

let cached = { token: null, exp: 0 };

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function getAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > nowSec) return cached.token;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(serviceAccount.private_key)
    .toString('base64url');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  cached = { token: json.access_token, exp: nowSec + (json.expires_in || 3600) };
  return cached.token;
}

// ---- Sending ---------------------------------------------------------------

function isDeadTokenError(status, errJson) {
  if (status === 404) return true;
  const code = errJson?.error?.status || '';
  const msg = errJson?.error?.message || '';
  return (
    code === 'NOT_FOUND' ||
    code === 'UNREGISTERED' ||
    /not.*registered|invalid.*registration|invalid.*argument/i.test(msg)
  );
}

async function sendOne(accessToken, token, payload) {
  const { title, body, data } = payload;
  // FCM data values must be strings.
  const stringData = {};
  for (const [k, v] of Object.entries(data || {})) {
    stringData[k] = v == null ? '' : String(v);
  }
  const message = {
    token,
    notification: { title, body },
    data: stringData,
    android: {
      priority: 'high',
      notification: { sound: 'default', channel_id: 'ping_messages' },
    },
  };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    }
  );
  if (res.ok) return true;
  let errJson = null;
  try {
    errJson = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (isDeadTokenError(res.status, errJson)) {
    removePushToken(token);
  } else {
    console.error('[push] FCM send failed:', res.status, errJson?.error?.message || '');
  }
  return false;
}

/**
 * Send a notification to every device of the given users. Fire-and-forget from
 * the caller's perspective — failures are logged, dead tokens pruned.
 */
export async function sendPushToUsers(userIds, payload) {
  if (!pushEnabled() || userIds.length === 0) return 0;
  const tokens = tokensForUsers(userIds);
  if (tokens.length === 0) return 0;
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error('[push]', e.message);
    return 0;
  }
  const results = await Promise.allSettled(
    tokens.map((t) => sendOne(accessToken, t, payload))
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}
