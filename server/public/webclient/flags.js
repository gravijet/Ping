/* flags.js — lightweight feature flags. Three layers, last one wins:
     1. built-in DEFAULTS (below),
     2. remote flags from GET /api/config (store.state.config.flags),
     3. local per-device overrides in localStorage (set from the debug panel).

   Use flag('name') anywhere to gate a feature; the debug panel (debug.js) lets
   a developer flip overrides live without a deploy. Keeping flags here — not
   scattered behind `if (location.search…)` checks — means there is one list to
   reason about and one switchboard to flip them from. */

import * as store from './store.js';

const LS_KEY = 'ping.flags';

// Built-in defaults. Add a flag here, reference it with flag('x'), done.
export const DEFAULTS = {
  outbox: true,          // persistent offline send-queue
  shareButtons: true,    // Web-Share / copy-link affordances
  diagnostics: true,     // allow the opt-in diagnostics module to run at all
  skeletons: true,       // skeleton loading states
  connectionBanner: true,// offline / reconnecting banner
  commandPalette: true,  // Ctrl/⌘+K palette (already shipped; flag for kill-switch)
  debugPanel: true,      // Ctrl+Shift+D developer panel
};

function localOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
  catch { return {}; }
}

/** Resolve a flag's effective value across all three layers. */
export function flag(name) {
  const local = localOverrides();
  if (Object.prototype.hasOwnProperty.call(local, name)) return !!local[name];
  const remote = store.state.config?.flags;
  if (remote && Object.prototype.hasOwnProperty.call(remote, name)) return !!remote[name];
  return !!DEFAULTS[name];
}

/** Set (or clear, with value === null) a local override and persist it. */
export function setFlag(name, value) {
  const local = localOverrides();
  if (value === null || value === undefined) delete local[name];
  else local[name] = !!value;
  localStorage.setItem(LS_KEY, JSON.stringify(local));
  store.emit('flags');
}

export function clearOverrides() {
  localStorage.removeItem(LS_KEY);
  store.emit('flags');
}

/** Snapshot of every known flag with its effective value + source — for the UI. */
export function allFlags() {
  const local = localOverrides();
  const remote = store.state.config?.flags || {};
  const names = new Set([...Object.keys(DEFAULTS), ...Object.keys(remote), ...Object.keys(local)]);
  return [...names].sort().map((name) => {
    let source = 'default';
    if (Object.prototype.hasOwnProperty.call(local, name)) source = 'override';
    else if (Object.prototype.hasOwnProperty.call(remote, name)) source = 'remote';
    return { name, value: flag(name), source, overridden: source === 'override' };
  });
}
