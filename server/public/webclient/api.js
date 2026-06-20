/* api.js — thin REST client for Ping's /api. Holds the JWT, signs every request
   with a Bearer header, and (because auth-gated images can't carry a header on
   an <img>) fetches binary resources into cached blob: URLs. */

const BASE = '/api';
const TOKEN_KEY = 'ping.token';

let token = localStorage.getItem(TOKEN_KEY) || null;
const onUnauthorizedCbs = [];

// Developer offline simulation (debug panel): when on, every request fails as if
// the network were down, so the offline-first paths (outbox, cache) can be
// exercised on demand without actually pulling the cable.
let offlineSim = false;
export function setOfflineSim(on) { offlineSim = !!on; }
export function isOfflineSim() { return offlineSim; }

export function getToken() { return token; }
export function setToken(t) {
  token = t || null;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function onUnauthorized(cb) { onUnauthorizedCbs.push(cb); }

class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

// ---- request inspector ----------------------------------------------------
// A small ring buffer of recent requests powers the debug panel's API inspector.
// It stores only method/path/status/timing — never bodies or auth headers.
const REQ_LOG_MAX = 60;
const reqLog = [];
function logRequest(method, path, status, ms) {
  reqLog.push({ t: Date.now(), method, path, status, ms, ok: status >= 200 && status < 400 });
  if (reqLog.length > REQ_LOG_MAX) reqLog.splice(0, reqLog.length - REQ_LOG_MAX);
}
export function recentRequests() { return reqLog.slice(); }

async function request(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (raw && body !== undefined) {
    opts.body = body;
  }
  const started = performance.now();
  const logPath = path.split('?')[0]; // drop query strings (may carry ids/tokens)
  if (offlineSim) {
    logRequest(method, logPath, 0, 0);
    throw new ApiError(0, 'Offline (Simulation).');
  }
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    logRequest(method, logPath, 0, Math.round(performance.now() - started));
    throw new ApiError(0, 'Keine Verbindung zum Server.');
  }
  logRequest(method, logPath, res.status, Math.round(performance.now() - started));
  if (res.status === 401 && token) {
    // Session died server-side — let the app drop back to login.
    for (const cb of onUnauthorizedCbs) cb();
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `Fehler ${res.status}`, data);
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b, o),
  put: (p, b, o) => request('PUT', p, b, o),
  patch: (p, b, o) => request('PATCH', p, b, o),
  del: (p, b, o) => request('DELETE', p, b, o),
  ApiError,
};

// Upload raw bytes (image/file/audio/video). Returns the upload meta
// ({ id, url, mime, name, size, ... }). The server sniffs images from their
// magic bytes; we pass the declared mime + filename via headers.
export async function uploadFile(file) {
  const buf = await file.arrayBuffer();
  return request('POST', '/uploads', buf, {
    raw: true,
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name || 'datei'),
    },
  }).then((r) => r.upload);
}

// ---- authed blob: URLs for <img>/<audio>/<video> --------------------------
const blobCache = new Map(); // cacheKey -> Promise<objectURL|null>

export function authedObjectUrl(path, version = 0) {
  const key = `${path}@${version}`;
  if (blobCache.has(key)) return blobCache.get(key);
  const p = (async () => {
    if (offlineSim) return null;
    try {
      const res = await fetch(BASE + path.replace(/^\/api/, ''), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch { return null; }
  })();
  blobCache.set(key, p);
  return p;
}

export function clearBlobCache() {
  for (const p of blobCache.values()) p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
  blobCache.clear();
}
