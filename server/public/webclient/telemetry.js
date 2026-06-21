/* telemetry.js — privacy-first diagnostics. Ping promises "kein Tracking", and
   this module is built to keep that promise:

     • Behaviour EVENTS stay LOCAL by default. A small ring buffer lives in
       memory purely to power the in-app debug panel; nothing is sent unless the
       user turns on "Diagnose senden" (prefs.diagnostics, default off).
     • CRASH REPORTS (Fehlerberichte) auto-send to the dev bug inbox when the
       'errorReporting' flag is on (default) — so the developer (and a fresh
       Claude session) sees and fixes real crashes. A crash payload carries only
       a stack trace + page path + app version; never the user id, phone or
       message content. The anonymous per-device id is sent ONLY if it already
       exists (an opted-in device) — auto crash reports never mint a new id.

   track(name, props) records an event; recordError(err) captures a crash. The
   global window 'error' / 'unhandledrejection' handlers are wired in install(). */

import * as prefs from './prefs.js';
import { flag } from './flags.js';

// App version for crash reports — captured lazily in install() so this module
// (imported at boot) doesn't statically pull in the settings UI graph.
let appVersion = null;

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

// The stored anonymous id *without* creating one. Auto crash reports use this so
// a device that never opted into analytics keeps having no persistent id at all.
function existingAid() {
  try { return localStorage.getItem(AID_KEY) || null; } catch { return null; }
}

function optedIn() {
  return flag('diagnostics') && prefs.get('diagnostics') === true;
}

// Whether crash reports should auto-send. On by default; a remote/local
// 'errorReporting' flag is the kill-switch for a noisy build.
function errorReportingOn() {
  return flag('errorReporting');
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
  // Auto-send crashes to the dev bug inbox (default on), or whenever the user
  // has opted into full diagnostics.
  if (errorReportingOn() || optedIn()) sendError(rec);
}

export function getEvents() { return events.slice(); }
export function getErrors() { return errors.slice(); }
export function clearAll() { events.length = 0; errors = []; persistErrors(); }

// ---- performance metrics --------------------------------------------------
// Reduce the browser's Navigation + Paint timing entries to a few human numbers
// (milliseconds, rounded). Pure — exported for unit testing — so the collection
// in getPerf() is a thin wrapper around the real Performance API.
export function shapePerf(nav, paintEntries = []) {
  if (!nav) return null;
  const fcp = (paintEntries.find((p) => p.name === 'first-contentful-paint') || {}).startTime;
  const ms = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : null);
  return {
    ttfb: ms(nav.responseStart),                                  // time to first byte
    domContentLoaded: ms(nav.domContentLoadedEventEnd),
    domInteractive: ms(nav.domInteractive),
    load: ms(nav.loadEventEnd),
    fcp: ms(fcp),                                                 // first contentful paint
    transferKb: typeof nav.transferSize === 'number' ? Math.round(nav.transferSize / 1024) : null,
  };
}

/** Collect the current page's performance metrics, or null if unavailable. */
export function getPerf() {
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const paint = performance.getEntriesByType?.('paint') || [];
    return shapePerf(nav, paint);
  } catch { return null; }
}

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
  // Send the opted-in device's id if it exists, but never mint one for an
  // auto-only report. appVersion pins the report to a build.
  post('/client-error', { aid: optedIn() ? anonId() : existingAid(), app: 'web', appVersion, ...rec });
}

/** Send a single anonymous, *bucketed* device snapshot (battery/network/RAM
    bands — never raw values) to the fleet endpoint. Opt-in only, fire-and-forget,
    and lazily imports device.js so a non-opted-in session never loads it. */
export async function sendDeviceSnapshot() {
  if (!optedIn() || !flag('deviceDiagnostics')) return;
  try {
    const { snapshot } = await import('./device.js');
    const metrics = await snapshot();
    if (metrics && Object.keys(metrics).length) {
      post('/telemetry/device', { aid: anonId(), app: 'web', metrics });
    }
  } catch { /* diagnostics are best-effort; never disturb the app */ }
}

/** Wire the global error handlers + flush-on-hide. Call once at boot. */
export function install() {
  if (installed) return; installed = true;

  // Learn our build number for crash reports without statically importing the
  // settings UI graph at boot. Best-effort; reports before this resolves just
  // carry a null version.
  import('./settings.js').then((m) => { appVersion = m.WEB_CLIENT_VERSION || null; }).catch(() => {});

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
  // One bucketed device snapshot per session, after the page settles (opt-in).
  setTimeout(() => { sendDeviceSnapshot(); }, 6000);

  // Record a one-off performance sample after the page settles. Kept local for
  // the debug panel; only the bare 'perf' event name is ever sent (opt-in).
  if (flag('perfMetrics')) {
    const sample = () => { const perf = getPerf(); if (perf) track('perf', perf); };
    if (document.readyState === 'complete') setTimeout(sample, 0);
    else window.addEventListener('load', () => setTimeout(sample, 0), { once: true });
  }
}
