import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { tokensForUsers, removePushToken } from './pushRepo.js';
import { webSubscriptionsForUsers, removeWebPushSubscription } from './webPushRepo.js';
import { webPushEnabled, sendWebPushToSubscriptions } from './webpush.js';

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
  const { title, body, data, android, channelId, clientNotification } = payload;
  // FCM data values must be strings.
  const stringData = {};
  for (const [k, v] of Object.entries(data || {})) {
    stringData[k] = v == null ? '' : String(v);
  }
  // A payload with no title/body is a *silent data message*: the client's
  // background handler turns it into the right UI (e.g. a full-screen incoming
  // call) instead of the OS drawing a tray notification. Used for calls.
  //
  // `clientNotification` is the same idea for *visible* notifications: the app
  // draws the notification itself (so it can attach inline reply / mark-read
  // actions) rather than letting the OS render a static tray card. Title/body
  // ride along inside `data` so the Android side still has them — and they also
  // stay on the top-level payload so the Web Push path (push.js → webpush.js)
  // keeps working unchanged. Used for new-message notifications.
  const isDataOnly = (!title && !body) || !!clientNotification;
  if (clientNotification) {
    if (title != null) stringData.title = String(title);
    if (body != null) stringData.body = String(body);
  }
  const message = {
    token,
    data: stringData,
    android: {
      priority: 'high',
      ...(android || {}),
      ...(isDataOnly
        ? {}
        : {
            notification: {
              sound: 'default',
              channel_id: channelId || 'ping_messages',
            },
          }),
    },
  };
  if (!isDataOnly) message.notification = { title, body };
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
  // Never hit the network (or a real device) from the test suite.
  if (process.env.NODE_ENV === 'test') return 0;
  if (userIds.length === 0) return 0;

  // Browsers (Ping Web + the Windows shell) get the same notification over Web
  // Push — but only for *visible* ones. A title-less/body-less data message is a
  // silent control push (e.g. an incoming WebRTC call) that only the Android
  // background handler knows how to turn into UI, so it never goes to the web.
  const isVisible = !!(payload.title || payload.body);
  const webPromise =
    isVisible && webPushEnabled()
      ? sendWebPushToSubscriptions(
          webSubscriptionsForUsers(userIds),
          {
            title: payload.title || 'Ping',
            body: payload.body || '',
            data: payload.data || {},
            tag: payload.data?.chatId || payload.data?.route || undefined,
          },
          removeWebPushSubscription
        ).catch(() => 0)
      : Promise.resolve(0);

  let fcmPromise = Promise.resolve(0);
  if (pushEnabled()) {
    const tokens = tokensForUsers(userIds);
    if (tokens.length > 0) {
      fcmPromise = (async () => {
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
      })();
    }
  }

  const [fcm, web] = await Promise.all([fcmPromise, webPromise]);
  return fcm + web;
}
