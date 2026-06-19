/* webclient-device.test.js — unit tests for the web client's device diagnostics
   module. device.js touches only `navigator` / `window` at *call* time (never at
   import), so we shim a minimal browser environment, then verify the coarse
   bucketing (shared vocabulary with the Android fleet telemetry) and the
   adaptive data-saver decision.

   device.js intentionally caches the BatteryManager once (in a real browser it's
   a single live object whose .level updates via events). That's correct in
   production but would leak battery state across cases here, so each test loads a
   *fresh* module instance via a cache-busting import specifier. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

let bust = 0;
async function freshDevice() {
  return import(`../public/webclient/device.js?t=${bust++}`);
}

function shimNavigator(over = {}) {
  // Node ≥21 exposes a read-only `navigator` getter, so assignment throws —
  // redefine the property instead.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      onLine: true,
      cookieEnabled: true,
      language: 'de-DE',
      platform: 'Linux x86_64',
      deviceMemory: 6,
      hardwareConcurrency: 8,
      getBattery: async () => ({ level: 0.5, charging: true }),
      connection: { type: 'wifi', effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
      storage: { estimate: async () => ({ usage: 1048576, quota: 104857600 }) },
      ...over,
    },
  });
  globalThis.window = {
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    devicePixelRatio: 2,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
}

test('snapshot buckets battery/ram/cores into the shared vocabulary', async () => {
  shimNavigator();
  const { snapshot } = await freshDevice();
  const m = await snapshot();
  assert.equal(m.platform, 'web');
  assert.equal(m.battery, '40-59');
  assert.equal(m.charging, 'yes');
  assert.equal(m.ram, '6-8');
  assert.equal(m.cores, '5-8');
  assert.equal(m.net, 'wifi');
  assert.equal(m.netgen, '4g');
  assert.equal(m.savedata, 'off');
  assert.equal(m.online, 'yes');
});

test('snapshot omits unavailable readings rather than inventing them', async () => {
  shimNavigator({ getBattery: undefined, deviceMemory: undefined, hardwareConcurrency: undefined });
  const { snapshot } = await freshDevice();
  const m = await snapshot();
  assert.ok(!('battery' in m), 'no battery bucket without the API');
  assert.ok(!('ram' in m));
  assert.ok(!('cores' in m));
  assert.equal(m.platform, 'web'); // still reports what it can
});

test('snapshot edge buckets: low battery, capped RAM, many cores', async () => {
  shimNavigator({
    getBattery: async () => ({ level: 0.05, charging: false }),
    deviceMemory: 8,
    hardwareConcurrency: 16,
  });
  const { snapshot } = await freshDevice();
  const m = await snapshot();
  assert.equal(m.battery, '0-19');
  assert.equal(m.charging, 'no');
  assert.equal(m.ram, '8+');
  assert.equal(m.cores, '8+');
});

test('prefersDataSaver respects Save-Data and slow links', async () => {
  const { prefersDataSaver } = await freshDevice();
  shimNavigator({ connection: { saveData: true, effectiveType: '4g' } });
  assert.equal(prefersDataSaver(), true);
  shimNavigator({ connection: { saveData: false, effectiveType: '2g' } });
  assert.equal(prefersDataSaver(), true);
  shimNavigator({ connection: { saveData: false, effectiveType: 'slow-2g' } });
  assert.equal(prefersDataSaver(), true);
  shimNavigator({ connection: { saveData: false, effectiveType: '4g' } });
  assert.equal(prefersDataSaver(), false);
});

test('prefersDataSaver is false when no Network Information API exists', async () => {
  shimNavigator({ connection: undefined });
  const { prefersDataSaver } = await freshDevice();
  assert.equal(prefersDataSaver(), false);
});

test('collect returns a fully shaped, null-safe snapshot', async () => {
  shimNavigator();
  const { collect } = await freshDevice();
  const d = await collect();
  assert.equal(d.online, true);
  assert.equal(d.battery.level, 50);
  assert.equal(d.connection.effectiveType, '4g');
  assert.equal(d.storage.quota, 104857600);
  assert.equal(d.hardware.cores, 8);
  assert.equal(d.display.viewport, '1280×800');
});
