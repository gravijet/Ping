/* socket.js — the realtime WebSocket. Connects to /ws?token=JWT, dispatches the
   server's typed events to listeners, auto-reconnects with backoff, and keeps a
   liveness ping going. One instance for the whole app. */

const listeners = new Map(); // type -> Set<fn>
let ws = null;
let token = null;
let backoff = 1000;
let pingTimer = null;
let closedByUs = false;
let statusCb = null; // (connected:boolean) => void

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}
function emit(type, payload) {
  const set = listeners.get(type);
  if (set) for (const fn of set) { try { fn(payload); } catch (e) { console.error(e); } }
}

export function onStatus(cb) { statusCb = cb; }

/** Is the realtime socket currently open? (Used by the debug panel + banner.) */
export function isConnected() { return !!ws && ws.readyState === WebSocket.OPEN; }

export function connect(jwt) {
  token = jwt;
  closedByUs = false;
  open();
}

function open() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    backoff = 1000;
    statusCb && statusCb(true);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send('ping', {}), 25000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.type) emit(msg.type, msg.payload || {});
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    statusCb && statusCb(false);
    if (closedByUs) return;
    setTimeout(open, backoff);
    backoff = Math.min(backoff * 1.6, 15000);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

export function send(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
    return true;
  }
  return false;
}

export function disconnect() {
  closedByUs = true;
  clearInterval(pingTimer);
  if (ws) { try { ws.close(); } catch {} ws = null; }
}
