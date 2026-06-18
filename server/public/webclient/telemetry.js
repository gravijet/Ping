/* telemetry.js — privacy-first diagnostics. Ping promises "kein Tracking", and
   this module is built to keep that promise:

     • Everything is LOCAL by default. A small ring buffer of events and crash
       reports lives in memory (crashes also in localStorage so they survive a
       reload) purely to power the in-app debug panel.
     • Nothing leaves the device unless the user explicitly turns on
       "Diagnose & Absturzberichte senden" (prefs.diagnostics, default off).
     • When opted in we send an ANONYMOUS payload — a random per-device id, never
       the user id, phone or message content — to /api/telemetry and
       /api/client-error, batched and via sendBeacon on page hide.

   track(name, props) records an event; recordError(err) captures a crash. The
   global window 'error' / 'unhandledrejection' handlers are wired in install(). */

import * as prefs from './prefs.js';
import { flag } from './flags.js';

const EVENTS_MAX = 200;   // in-memory ring buffer (debug panel)
const ERRORS_MAX = 50;    // crash reports (also persisted)
const ERR_KEY = 'ping.crashlog';
const AID_KEY = 'ping.aid'; // anonymous device id, only created on first send

const events = [];
let errors = loadErrors();
let outQueue = [];        // events awaiting an opted-in beacon
let installed = false;

function loadErrors() {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]') || []; }
  catch { return []; }
}
function persistErrors() {
  try { localStorage.setItem(ERR_KEY, JSON.stringify(errors.slice(-ERRORS_MAX))); }
  catch { /* quota — ignore */ }
}

// Anonymous, opaque, per-device. Generated lazily and only when the user has
// opted in to sending diagnostics, so a non-opted-in device has no id at all.
function anonId() {
  let id = localStorage.getItem(AID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36));
    localStorage.setItem(AID_KEY, id);
  }
  return id;
}

function optedIn() {
  return flag('diagnostics') && prefs.get('diagnostics') === true;
}

/** Record a lightweight named event. Always local; only queued for sending
    when the user has opted in. */
export function track(name, props = {}) {
  const ev = { t: Date.now(), name: String(name).slice(0, 60), props };
  events.push(ev);
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
  if (optedIn()) {
    outQueue.push({ name: ev.name, t: ev.t });
    if (outQueue.length >= 25) flush();
  }
}

/** Capture an error/crash into the local crash log (+ queue when opted in). */
export function recordError(err, context = 'app') {
  const rec = {
    t: Date.now(),
    context,
    message: (err && (err.message || String(err))) || 'Unbekannter Fehler',
    stack: (err && err.stack ? String(err.stack) : '').slice(0, 2000),
    url: location.pathname,
  };
  errors.push(rec);
  if (errors.length > ERRORS_MAX) errors.splice(0, errors.length - ERRORS_MAX);
  persistErrors();
  if (optedIn()) sendError(rec);
}

export function getEvents() { return events.slice(); }
export function getErrors() { return errors.slice(); }
export function clearAll() { events.length = 0; errors = []; persistErrors(); }

// ---- sending (opt-in only) ------------------------------------------------
function post(path, body) {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    // sendBeacon can't set headers, but these endpoints are anonymous and need
    // none. It also survives page unload, which is exactly when we flush.
    if (navigator.sendBeacon && navigator.sendBeacon('/api' + path, blob)) return;
  } catch { /* fall through to fetch */ }
  fetch('/api' + path, {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function flush() {
  if (!optedIn() || !outQueue.length) return;
  const batch = outQueue.splice(0, outQueue.length);
  post('/telemetry', {
    aid: anonId(),
    ua: navigator.userAgent.slice(0, 200),
    app: 'web',
    events: batch,
  });
}

function sendError(rec) {
  post('/client-error', { aid: anonId(), app: 'web', ...rec });
}

/** Wire the global error handlers + flush-on-hide. Call once at boot. */
export function install() {
  if (installed) return; installed = true;

  window.addEventListener('error', (e) => {
    recordError(e.error || { message: e.message, stack: `${e.filename}:${e.lineno}:${e.colno}` }, 'window');
  });
  window.addEventListener('unhandledrejection', (e) => {
    recordError(e.reason || { message: 'Unhandled promise rejection' }, 'promise');
  });
  // Flush queued events when the tab is hidden or closed.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  track('app_open');
}
