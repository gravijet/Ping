/* device.js — read-only device & connection diagnostics for the web client.

   The browser exposes a surprising amount of genuinely hardware-near
   information, and this module gathers it behind one small, defensive API:

     • Battery Status API   — navigator.getBattery() (level, charging)
     • Network Information   — navigator.connection (type, effectiveType, saveData)
     • Device memory / cores — navigator.deviceMemory, .hardwareConcurrency
     • Storage estimate      — navigator.storage.estimate() (quota/usage)
     • Online state + screen — navigator.onLine, window.screen, devicePixelRatio

   Everything degrades gracefully: an unsupported API yields `null`, never an
   exception, so the diagnostics panel can render "nicht verfügbar" instead.

   Two consumers:
     1. the "Gerät" settings section (live snapshot, see settings.js), and
     2. adaptive behaviour — prefersDataSaver() lets the app throttle idle
        prefetch on metered / save-data / slow connections, and the bucketed
        snapshot() feeds the anonymous device-fleet telemetry (opt-in).

   The bucket labels here are deliberately the *same vocabulary* the Android
   client uses, so the server's fleet view aggregates web + mobile cleanly. */

let batteryRef = null; // cached BatteryManager so we can attach listeners once

// ---- raw collectors (all null-safe) ---------------------------------------

async function battery() {
  try {
    if (!navigator.getBattery) return null;
    batteryRef = batteryRef || (await navigator.getBattery());
    const b = batteryRef;
    return {
      level: typeof b.level === 'number' ? Math.round(b.level * 100) : null,
      charging: !!b.charging,
    };
  } catch { return null; }
}

function connection() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return {
    type: c.type || null, // 'wifi'|'cellular'|'ethernet'|… (often absent)
    effectiveType: c.effectiveType || null, // 'slow-2g'|'2g'|'3g'|'4g'
    downlink: typeof c.downlink === 'number' ? c.downlink : null, // Mbit/s estimate
    rtt: typeof c.rtt === 'number' ? c.rtt : null, // ms
    saveData: !!c.saveData,
  };
}

async function storage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return {
      usage: typeof e.usage === 'number' ? e.usage : null,
      quota: typeof e.quota === 'number' ? e.quota : null,
    };
  } catch { return null; }
}

function hardware() {
  return {
    memoryGb: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
    cores: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
    platform: navigator.platform || null,
  };
}

function display() {
  const s = window.screen || {};
  return {
    width: s.width || null,
    height: s.height || null,
    dpr: window.devicePixelRatio || 1,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    colorDepth: s.colorDepth || null,
  };
}

/** A full, human-readable snapshot for the diagnostics panel. */
export async function collect() {
  const [batt, store] = await Promise.all([battery(), storage()]);
  return {
    online: navigator.onLine,
    battery: batt,
    connection: connection(),
    storage: store,
    hardware: hardware(),
    display: display(),
    language: navigator.language || null,
    cookiesEnabled: navigator.cookieEnabled,
  };
}

// ---- bucketing (for the anonymous fleet telemetry) ------------------------

function batteryBucket(level) {
  if (level == null) return null;
  if (level < 20) return '0-19';
  if (level < 40) return '20-39';
  if (level < 60) return '40-59';
  if (level < 80) return '60-79';
  return '80-100';
}

function ramBucket(gb) {
  if (gb == null) return null;
  if (gb < 2) return '<2';
  if (gb < 4) return '2-4';
  if (gb < 6) return '4-6';
  if (gb < 8) return '6-8';
  return '8+';
}

function coresBucket(n) {
  if (n == null) return null;
  if (n <= 2) return '1-2';
  if (n <= 4) return '3-4';
  if (n <= 8) return '5-8';
  return '8+';
}

function netBucket(type) {
  if (!type) return 'unknown';
  if (['wifi', 'cellular', 'ethernet', 'none'].includes(type)) return type;
  return 'other';
}

/** Coarse, privacy-safe metric→bucket map shared with the server fleet view. */
export async function snapshot() {
  const d = await collect();
  const m = {
    platform: 'web',
    net: netBucket(d.connection?.type),
    netgen: d.connection?.effectiveType || 'unknown',
    savedata: d.connection?.saveData ? 'on' : 'off',
    online: d.online ? 'yes' : 'no',
  };
  const batt = batteryBucket(d.battery?.level);
  if (batt) { m.battery = batt; m.charging = d.battery.charging ? 'yes' : 'no'; }
  const ram = ramBucket(d.hardware?.memoryGb);
  if (ram) m.ram = ram;
  const cores = coresBucket(d.hardware?.cores);
  if (cores) m.cores = cores;
  return m;
}

// ---- adaptive behaviour ---------------------------------------------------

/** True when we should hold back non-essential network work (idle prefetch,
    high-res images): the user asked to save data, or the link is slow/metered. */
export function prefersDataSaver() {
  const c = connection();
  if (!c) return false;
  if (c.saveData) return true;
  return c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
}

/** Subscribe to live changes (battery, connection, online/offline). Returns an
    unsubscribe function. The callback gets no args — re-read via collect(). */
export function onChange(cb) {
  const handlers = [];
  const add = (target, ev) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(ev, cb);
    handlers.push(() => target.removeEventListener(ev, cb));
  };
  add(window, 'online');
  add(window, 'offline');
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  add(c, 'change');
  // Battery is async; attach once it resolves (if still subscribed).
  let cancelled = false;
  battery().then(() => {
    if (cancelled || !batteryRef) return;
    for (const ev of ['levelchange', 'chargingchange']) add(batteryRef, ev);
  });
  return () => { cancelled = true; handlers.forEach((off) => off()); };
}
