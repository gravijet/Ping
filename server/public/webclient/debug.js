/* debug.js — the developer / diagnostics panel (Strg+Shift+D, or the command
   palette). One place to see what the client is doing: connection state, the
   live store, feature flags you can flip without a deploy, the local event log,
   captured crashes, a request inspector and the offline outbox. Lazily imported
   so none of this weighs on the initial load. */

import { modal, el, icon, switchEl, toast } from './ui.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import * as telemetry from './telemetry.js';
import * as outbox from './outbox.js';
import * as cache from './cache.js';
import * as syncqueue from './syncqueue.js';
import { allFlags, setFlag, clearOverrides } from './flags.js';
import { recentRequests, setOfflineSim, isOfflineSim } from './api.js';
import * as socket from './socket.js';

const fmtTime = (t) => new Date(t).toLocaleTimeString('de-DE', { hour12: false });
function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function section(title, body) {
  return el('div', { class: 'dbg-sec' }, [
    el('h4', { class: 'dbg-h', text: title }),
    body,
  ]);
}

function kv(label, value, valueClass = '') {
  return el('div', { class: 'dbg-kv' }, [
    el('span', { class: 'dbg-k', text: label }),
    el('span', { class: `dbg-v ${valueClass}`.trim(), text: String(value) }),
  ]);
}

export function openDebugPanel() {
  let m;
  const render = (body) => {
    body.replaceChildren();
    body.appendChild(buildBody(() => render(body)));
  };
  m = modal({ title: 'Debug & Diagnose', width: '640px', body: render });
  return m;
}

function buildBody(rerender) {
  const wrap = el('div', { class: 'dbg' });

  // --- Connection ---------------------------------------------------------
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  wrap.appendChild(section('Verbindung', el('div', { class: 'dbg-grid' }, [
    kv('Netzwerk', online ? 'online' : 'offline', online ? 'ok' : 'bad'),
    kv('Realtime', socket.isConnected?.() ? 'verbunden' : 'getrennt',
      socket.isConnected?.() ? 'ok' : 'bad'),
    kv('Version', store.state.config?.version || '–'),
    kv('User-Agent', navigator.userAgent.slice(0, 48) + '…'),
  ])));

  // --- Store snapshot -----------------------------------------------------
  wrap.appendChild(section('Store', el('div', { class: 'dbg-grid' }, [
    kv('Angemeldet', store.state.me?.displayName || '–'),
    kv('Chats', store.state.chats.size),
    kv('Verläufe geladen', store.state.messages.size),
    kv('Online-Nutzer', store.state.online.size),
    kv('Outbox', outbox.count()),
    kv('Aktiver Chat', store.state.activeId || '–'),
  ])));

  // --- Performance --------------------------------------------------------
  const perf = telemetry.getPerf();
  const ms = (v) => (v != null ? `${v} ms` : '–');
  wrap.appendChild(section('Leistung', el('div', { class: 'dbg-grid' }, perf ? [
    kv('TTFB', ms(perf.ttfb)),
    kv('DOM interaktiv', ms(perf.domInteractive)),
    kv('First Paint', ms(perf.fcp)),
    kv('Vollständig geladen', ms(perf.load)),
    kv('Übertragen', perf.transferKb != null ? `${perf.transferKb} KB` : '–'),
  ] : [kv('Status', 'nicht verfügbar')])));

  // --- Cache & Offline ----------------------------------------------------
  const offSim = el('div', { class: 'dbg-row' }, [
    el('div', {}, [
      el('div', { text: 'Offline simulieren' }),
      el('div', { class: 'hint', text: 'Lässt alle Anfragen fehlschlagen – zum Testen von Outbox & Cache.' }),
    ]),
    switchEl(isOfflineSim(), (on) => {
      setOfflineSim(on);
      try { window.dispatchEvent(new Event(on ? 'offline' : 'online')); } catch { /* ignore */ }
      toast(on ? 'Offline-Simulation aktiv.' : 'Offline-Simulation aus.');
    }),
  ]);
  const cacheInfo = el('div', { class: 'dbg-grid' }, [el('div', { class: 'hint', text: 'Lade …' })]);
  cache.stats().then((s) => cacheInfo.replaceChildren(
    kv('IndexedDB', s.available ? 'verfügbar' : 'nicht verfügbar', s.available ? 'ok' : 'bad'),
    kv('Chats (Cache)', s.chats),
    kv('Verläufe', s.threads),
    kv('Nachrichten', s.messages),
    kv('Cache-Größe', fmtBytes(s.bytes)),
    kv('Sync-Queue', syncqueue.count()),
  )).catch(() => {});
  const cacheFoot = el('button', { class: 'btn ghost sm', onClick: async () => {
    await cache.clearAll(); rerender(); toast('Offline-Cache geleert.');
  } }, 'Offline-Cache leeren');
  wrap.appendChild(section('Cache & Offline', el('div', {}, [offSim, cacheInfo, cacheFoot])));

  // --- Diagnostics opt-in -------------------------------------------------
  const diag = el('div', { class: 'dbg-row' }, [
    el('div', {}, [
      el('div', { text: 'Diagnose & Absturzberichte senden' }),
      el('div', { class: 'hint', text: 'Anonym, ohne Inhalte. Standardmäßig aus.' }),
    ]),
    switchEl(prefs.get('diagnostics') === true, (on) => { prefs.set('diagnostics', on); }),
  ]);
  wrap.appendChild(section('Diagnose', diag));

  // --- Feature flags ------------------------------------------------------
  const flags = el('div', { class: 'dbg-flags' });
  for (const f of allFlags()) {
    flags.appendChild(el('div', { class: 'dbg-row' }, [
      el('div', {}, [
        el('code', { text: f.name }),
        el('span', { class: `dbg-tag ${f.overridden ? 'on' : ''}`, text: f.source }),
      ]),
      switchEl(f.value, (on) => { setFlag(f.name, on); }),
    ]));
  }
  const flagFoot = el('button', { class: 'btn ghost sm',
    onClick: () => { clearOverrides(); rerender(); toast('Flag-Overrides zurückgesetzt.'); } },
    'Overrides zurücksetzen');
  wrap.appendChild(section('Feature-Flags', el('div', {}, [flags, flagFoot])));

  // --- Event log ----------------------------------------------------------
  const evs = telemetry.getEvents().slice(-40).reverse();
  const evBody = el('div', { class: 'dbg-log' }, evs.length
    ? evs.map((e) => el('div', { class: 'dbg-line' }, [
        el('span', { class: 'dbg-t', text: fmtTime(e.t) }),
        el('span', { text: e.name }),
      ]))
    : [el('div', { class: 'hint', text: 'Noch keine Ereignisse.' })]);
  wrap.appendChild(section(`Ereignisse (${evs.length})`, evBody));

  // --- API inspector ------------------------------------------------------
  const reqs = recentRequests().slice(-30).reverse();
  const reqBody = el('div', { class: 'dbg-log' }, reqs.length
    ? reqs.map((r) => el('div', { class: 'dbg-line' }, [
        el('span', { class: 'dbg-t', text: fmtTime(r.t) }),
        el('span', { class: `dbg-m ${r.ok ? '' : 'bad'}`, text: `${r.status}` }),
        el('span', { class: 'dbg-mono', text: `${r.method} ${r.path}` }),
        el('span', { class: 'dbg-ms', text: `${r.ms}ms` }),
      ]))
    : [el('div', { class: 'hint', text: 'Noch keine Anfragen.' })]);
  wrap.appendChild(section(`API-Inspektor (${reqs.length})`, reqBody));

  // --- Crash log ----------------------------------------------------------
  const errs = telemetry.getErrors().slice(-20).reverse();
  const errBody = el('div', { class: 'dbg-log' }, errs.length
    ? errs.map((e) => el('div', { class: 'dbg-line err' }, [
        el('span', { class: 'dbg-t', text: fmtTime(e.t) }),
        el('span', { class: 'dbg-tag', text: e.context }),
        el('span', { text: e.message }),
      ]))
    : [el('div', { class: 'hint', text: 'Keine Abstürze aufgezeichnet. 🎉' })]);
  wrap.appendChild(section(`Absturzberichte (${errs.length})`, errBody));

  // --- Footer actions -----------------------------------------------------
  wrap.appendChild(el('div', { class: 'dbg-actions' }, [
    el('button', { class: 'btn ghost sm', onClick: copyDiagnostics }, [icon('copy', 'sm'),
      el('span', { text: 'Diagnose kopieren' })]),
    el('button', { class: 'btn ghost sm',
      onClick: () => { telemetry.clearAll(); rerender(); toast('Lokale Logs geleert.'); } },
      'Logs leeren'),
    el('button', { class: 'btn danger sm', onClick: hardReset },
      'Cache leeren & neu laden'),
  ]));

  return wrap;
}

async function copyDiagnostics() {
  const data = {
    version: store.state.config?.version || null,
    online: navigator.onLine,
    realtime: socket.isConnected?.() || false,
    ua: navigator.userAgent,
    chats: store.state.chats.size,
    outbox: outbox.count(),
    syncQueue: syncqueue.count(),
    perf: telemetry.getPerf(),
    offlineSim: isOfflineSim(),
    events: telemetry.getEvents().slice(-50),
    errors: telemetry.getErrors().slice(-20),
    requests: recentRequests().slice(-30),
    flags: allFlags(),
    ts: new Date().toISOString(),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast('Diagnose in die Zwischenablage kopiert.', 'ok');
  } catch { toast('Kopieren nicht möglich.', 'err'); }
}

// Unregister the service worker + clear its caches, then reload — the nuclear
// "something is stuck after an update" button.
async function hardReset() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  location.reload();
}
