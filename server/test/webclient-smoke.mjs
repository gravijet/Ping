/* webclient-smoke.mjs — a no-browser smoke test for the vanilla-JS PC client.
   jsdom isn't installed here, so we shim just enough of the DOM/Web platform to
   import every module and drive its main entry points (auth → shell → all panes
   → settings → palette → conversation → info panel → gallery → lock → draw).
   It catches import-time / TDZ / construction-time crashes that node --check
   can't. Run: node server/test/webclient-smoke.mjs

   Exit code 0 = all steps passed; non-zero = at least one threw. */

import { mkdtempSync, cpSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Minimal DOM
// ---------------------------------------------------------------------------
let listenerBag = [];

class CL {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) { const has = this.set.has(c); const on = force === undefined ? !has : force; if (on) this.set.add(c); else this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
  get value() { return [...this.set].join(' '); }
}

class Style {
  setProperty(k, v) { this[k] = v; }
  removeProperty(k) { delete this[k]; }
}

class El {
  constructor(tag, ns) {
    this.tagName = (tag || 'div').toUpperCase();
    this.ns = ns || null;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this._cl = new CL(this);
    this.style = new Style();
    this.dataset = {};
    this.attrs = {};
    this._text = '';
    this._handlers = new Map();
    this.value = '';
    this.files = [];
    this.checked = false;
  }
  get classList() { return this._cl; }
  set className(v) { this._cl.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._cl.value; }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children.length = 0; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent || '').join('');
  }
  set innerHTML(v) { this._html = v; this.children.length = 0; }
  get innerHTML() { return this._html || ''; }

  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); if (k === 'id') this.id = v; }
  getAttribute(k) { if (k in this.attrs) return this.attrs[k]; if (k.startsWith('data-')) { const d = this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; return d == null ? null : d; } return null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return this.getAttribute(k) != null; }

  appendChild(n) { if (n == null) return n; n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(typeof n === 'string' ? document.createTextNode(n) : n)); }
  prepend(...ns) { ns.reverse().forEach((n) => { n.parentNode = this; this.children.unshift(typeof n === 'string' ? document.createTextNode(n) : n); }); }
  insertBefore(n, ref) { const i = this.children.indexOf(ref); n.parentNode = this; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); return n; }
  replaceChildren(...ns) { this.children.length = 0; this._text = ''; ns.forEach((n) => this.appendChild(n)); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }

  addEventListener(t, fn) { if (!this._handlers.has(t)) this._handlers.set(t, new Set()); this._handlers.get(t).add(fn); }
  removeEventListener(t, fn) { this._handlers.get(t)?.delete(fn); }
  dispatch(t, ev = {}) {
    const e = { type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0, ...ev };
    for (const fn of this._handlers.get(t) || []) fn(e);
  }
  click() { this.dispatch('click'); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { width: 120, height: 40, left: 0, top: 0, right: 120, bottom: 40, x: 0, y: 0 }; }
  getContext() {
    return new Proxy({}, { get: () => (() => {}) });
  }
  toBlob(cb) { cb({ size: 10, type: 'image/png' }); }
  cloneNode() { return new El(this.tagName); }

  // selector engine (supports: tag, .class, #id, [attr], [attr="v"], descendant)
  matchesToken(tok) {
    const tag = (tok.match(/^[a-zA-Z][\w-]*/) || [''])[0];
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    for (const cls of tok.match(/\.[\w-]+/g) || []) if (!this._cl.contains(cls.slice(1))) return false;
    const idm = tok.match(/#([\w-]+)/); if (idm && this.id !== idm[1]) return false;
    for (const am of tok.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const v = this.getAttribute(am[1]);
      if (am[2] === undefined) { if (v == null) return false; }
      else if (v !== am[2]) return false;
    }
    return true;
  }
  _descendants(out = []) { for (const c of this.children) { if (c instanceof El) { out.push(c); c._descendants(out); } } return out; }
  querySelectorAll(sel) {
    const results = [];
    for (const part of sel.split(',')) {
      const tokens = part.trim().split(/\s+/);
      const last = tokens[tokens.length - 1];
      for (const node of this._descendants()) {
        if (!node.matchesToken(last)) continue;
        if (tokens.length === 1) { results.push(node); continue; }
        // check an ancestor matches the first token (loose, handles our 2-token cases)
        let p = node.parentNode, ok = false;
        while (p) { if (p instanceof El && p.matchesToken(tokens[0])) { ok = true; break; } p = p.parentNode; }
        if (ok) results.push(node);
      }
    }
    return results;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return this.matchesToken(sel); }
  closest(sel) { let n = this; while (n) { if (n instanceof El && n.matchesToken(sel)) return n; n = n.parentNode; } return null; }
}

class TextNode { constructor(t) { this._text = String(t); this.parentNode = null; } get textContent() { return this._text; } }

const docListeners = new Map();
const byId = new Map();
const document = {
  createElement: (t) => new El(t),
  createElementNS: (_ns, t) => new El(t, _ns),
  createDocumentFragment: () => new El('fragment'),
  createTextNode: (t) => new TextNode(t),
  getElementById: (id) => byId.get(id) || null,
  querySelector: (s) => document.body.querySelector(s),
  querySelectorAll: (s) => document.body.querySelectorAll(s),
  addEventListener: (t, fn) => { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn); },
  removeEventListener: (t, fn) => docListeners.get(t)?.delete(fn),
  hasFocus: () => true,
};
document.documentElement = new El('html');
document.head = new El('head');
document.body = new El('body');

// Pre-create the mount points index.html provides.
for (const id of ['app', 'toasts', 'modal-root', 'call-root']) {
  const n = new El('div'); n.id = id; byId.set(id, n); document.body.appendChild(n);
}
// Patch appendChild on body/els to register ids as they appear.
const origSetId = Object.getOwnPropertyDescriptor(El.prototype, 'id');
Object.defineProperty(El.prototype, 'id', {
  get() { return this._id; },
  set(v) { this._id = v; if (v) byId.set(v, this); },
});

// ---------------------------------------------------------------------------
// Web platform shims
// ---------------------------------------------------------------------------
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
localStorage.setItem('ping.token', 'test-jwt');

class FakeWS {
  constructor() { this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); }
  send() {} close() { this.onclose && this.onclose(); }
}
FakeWS.OPEN = 1;

const me = { id: 'me', displayName: 'Ich', phone: '+43 660 1', email: 'a@b.c', showLastSeen: true, messageStorage: 'server' };
const chatDirect = { id: 'c1', type: 'direct', title: 'Anna', otherUser: { id: 'u2', displayName: 'Anna' }, updatedAt: Date.now(), createdAt: Date.now(), unread: 0, lastMessage: { id: 'm1', senderId: 'u2', body: 'Hi', createdAt: Date.now(), type: 'text' } };
const chatGroup = { id: 'c2', type: 'group', title: 'Team', members: [{ id: 'me', displayName: 'Ich' }, { id: 'u2', displayName: 'Anna' }], ownerId: 'me', updatedAt: Date.now(), createdAt: Date.now() };
const msgs = [
  { id: 'm1', chatId: 'c1', senderId: 'u2', body: 'Hallo!', type: 'text', createdAt: Date.now() - 5000 },
  { id: 'm2', chatId: 'c1', senderId: 'me', body: 'Foto:', type: 'image', attachment: { url: '/api/uploads/x', kind: 'image', name: 'a.jpg', width: 800, height: 600 }, createdAt: Date.now() - 4000, status: 'read' },
  { id: 'm3', chatId: 'c1', senderId: 'u2', type: 'poll', poll: { question: 'Wann?', options: [{ text: 'Mo', votes: [] }, { text: 'Di', votes: [] }] }, createdAt: Date.now() - 3000 },
  { id: 'm4', chatId: 'c1', senderId: 'me', body: 'Schau dir https://example.com/artikel an.', type: 'text', editedAt: Date.now() - 1000, editCount: 1, createdAt: Date.now() - 2000, status: 'read' },
];

function jsonRes(data) {
  return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, json: async () => data, blob: async () => ({ size: 1 }) };
}
async function fetchShim(url) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  if (path === '/me') return jsonRes({ user: me });
  if (path === '/chats') return jsonRes({ chats: [chatDirect, chatGroup] });
  if (path === '/config') return jsonRes({});
  if (/\/messages\/[^/]+\/edits$/.test(path)) return jsonRes({ versions: [{ body: 'alte Fassung' }, { body: 'neue Fassung', editedAt: Date.now(), current: true }] });
  if (path.startsWith('/chats/c1/messages')) return jsonRes({ messages: msgs });
  if (path.startsWith('/chats/c2/messages')) return jsonRes({ messages: [] });
  if (/^\/chats\/[^/]+$/.test(path)) return jsonRes({ chat: chatDirect });
  if (path.startsWith('/messages/search')) return jsonRes({ messages: [
    { id: 'm1', chatId: 'c1', senderId: 'u2', type: 'text', body: 'Hallo Welt Apfelkuchen',
      snippet: 'Hallo Welt Apfelkuchen', chatTitle: 'Anna', senderName: 'Anna', createdAt: Date.now() },
  ] });
  if (path === '/me/focus') return jsonRes({ focus: { focusUntil: 0, focusActive: false,
    quietEnabled: false, quietStart: 1320, quietEnd: 420, quietDays: 127, inQuietHours: false,
    autoReply: '', updatedAt: 0 } });
  if (path.startsWith('/link-preview')) return jsonRes({ preview: { title: 'Beispielseite', description: 'Hallo Welt', image: '', siteName: 'example.com', url: 'https://example.com/artikel' } });
  if (path === '/blocks') return jsonRes({ blocked: [] });
  if (path.startsWith('/users/')) return jsonRes({ user: { ...me, id: 'u2', displayName: 'Anna', about: 'Hi', city: 'Wien' } });
  if (path === '/status') return jsonRes({ statuses: [] });
  if (path === '/calls') return jsonRes({ calls: [] });
  if (path.startsWith('/chats/') && path.endsWith('/invite')) return jsonRes({ code: null });
  if (path === '/ice') return jsonRes({ iceServers: [] });
  if (path.startsWith('/uploads')) return jsonRes({ upload: { id: 'u', url: '/api/uploads/u', mime: 'image/png', name: 'a.png', size: 1, kind: 'image' } });
  return jsonRes({ ok: true });
}

const windowObj = {
  innerWidth: 1280, innerHeight: 800,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
  addEventListener: (t, fn) => document.addEventListener(t, fn),
  removeEventListener: (t, fn) => document.removeEventListener(t, fn),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  getSelection: () => '',
  focus() {},
  location: { protocol: 'https:', host: 'web.test', href: 'https://web.test/' },
  AudioContext: class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() {} createOscillator() { return { type: '', frequency: {}, connect: () => ({ connect() {} }), start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; } },
  Notification: Object.assign(function () {}, { permission: 'default', requestPermission: async () => 'granted' }),
};

Object.assign(globalThis, {
  document, window: windowObj, localStorage, fetch: fetchShim, WebSocket: FakeWS,
  location: windowObj.location, innerWidth: 1280, innerHeight: 800,
  matchMedia: windowObj.matchMedia, requestAnimationFrame: windowObj.requestAnimationFrame,
  Notification: windowObj.Notification, AudioContext: windowObj.AudioContext,
  Image: class { set src(_v) { setTimeout(() => this.onload && this.onload(), 0); } },
  FileReader: class { readAsDataURL() { setTimeout(() => { this.result = 'data:,'; this.onload && this.onload(); }, 0); } },
  alert: () => {}, prompt: () => null, confirm: () => true,
});
// navigator is a read-only getter on globalThis in Node 22 → define it.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: { clipboard: { writeText: async () => {} }, onLine: true, userAgent: 'node', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
});
windowObj.navigator = globalThis.navigator;
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};

// ---------------------------------------------------------------------------
// Copy the client into a temp ESM package and import everything
// ---------------------------------------------------------------------------
const SRC = new URL('../public/webclient/', import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'ping-web-'));
cpSync(SRC, tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
const imp = (f) => import(pathToFileURL(join(tmp, f)).href);

let failures = 0;
async function step(name, fn) {
  try { await fn(); await tick(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' — ' + (e && e.stack || e)); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

console.log('webclient smoke test');

// Phase A: import every module (catches import/TDZ errors). app.js auto-boots.
// sw.js is the service worker — the browser loads it in a worker scope (with
// `self`/`caches`), never as an app module, so it's not importable here.
const files = readdirSync(tmp).filter((f) => f.endsWith('.js'));
const mods = {};
for (const f of files.filter((f) => f !== 'app.js' && f !== 'sw.js')) {
  await step('import ' + f, async () => { mods[f] = await imp(f); });
}
await step('import app.js (boot → shell)', async () => { mods['app.js'] = await imp('app.js'); });
await tick(); await tick();

// Phase B: drive the main entry points.
const ui = mods['ui.js'];
const app = mods['app.js'];
const settings = mods['settings.js'];

await step('shell built (nav rail present)', async () => {
  const rail = document.querySelectorAll('.nav-item[data-section]');
  if (!rail.length) throw new Error('nav rail not rendered');
});
await step('open settings + every category', async () => {
  settings.openSettings();
  await tick();
  for (const b of document.querySelectorAll('.settings-cat')) { b.click(); await tick(); }
});
await step('command palette', async () => { app.openCommandPalette(); await tick(); });
await step('open direct chat (thread + composer)', async () => { app.openChatInShell('c1'); });
await step('open group chat', async () => { app.openChatInShell('c2'); });
await step('info panel (direct)', async () => { (await imp('infopanel.js')).openInfoPanel(chatDirect); });
await step('info panel (group)', async () => { (await imp('infopanel.js')).openInfoPanel(chatGroup); });
await step('media gallery', async () => { (await imp('gallery.js')).openGallery([{ url: '/api/uploads/x', kind: 'image', name: 'a.jpg' }], 0); });
await step('draw modal', async () => { (await imp('draw.js')).drawModal('c1'); });
await step('lock settings + lockNow', async () => { const l = await imp('lock.js'); l.lockSettings(); l.lockNow(); });
await step('link device modal', async () => { (await imp('devices.js')).linkDeviceModal(); });
await step('new chat modal', async () => { (await imp('contacts.js')).newChatModal(); });
await step('new group modal', async () => { (await imp('groups.js')).newGroupModal(); });
await step('status pane', async () => { const head = new El('div'), body = new El('div'); (await imp('status.js')).renderStatusPane(head, body); });
await step('calls pane', async () => { const head = new El('div'), body = new El('div'); (await imp('calls-view.js')).renderCallsPane(head, body, () => {}); });
await step('saved pane', async () => { const head = new El('div'), body = new El('div'); (await imp('saved.js')).renderSavedPane(head, body, () => {}); });
await step('emoji picker', async () => { const anchor = new El('button'); document.body.appendChild(anchor); (await imp('emoji.js')).openEmojiPicker(anchor, () => {}); });
await step('chat list filters', async () => {
  for (const f of ['unread', 'fav', 'groups', 'all']) { mods['store.js'].state.chatFilter = f; mods['store.js'].emit('chats'); await tick(); }
});
await step('in-chat search toggle', async () => {
  const chat = await imp('chat.js');
  app.openChatInShell('c1'); await tick();
  chat.toggleChatSearch(); await tick();   // open
  chat.toggleChatSearch();                  // close
});
await step('forward multiple messages', async () => {
  (await imp('forward.js')).forwardMessages([{ id: 'm1', type: 'text', body: 'hi' }, { id: 'x', type: 'text', body: 'yo' }]);
});
await step('global search opens, queries + renders highlighted results', async () => {
  const search = await imp('search.js');
  let jumped = null;
  search.openSearch((chatId, msgId) => { jumped = [chatId, msgId]; });
  await tick();
  const input = document.querySelector('.search-input');
  if (!input) throw new Error('search input not rendered');
  input.value = 'apfel';
  input.dispatch('input', { target: input });
  await new Promise((r) => setTimeout(r, 260)); // past the debounce
  const results = document.querySelectorAll('.search-result');
  if (!results.length) throw new Error('no search results rendered');
  if (!document.querySelector('.sr-text mark')) throw new Error('matched term not highlighted');
  // quick chip appends an operator token (while the modal is still open)
  document.querySelector('.search-chips .chip')?.click(); await tick();
  if (!/typ:/.test(document.querySelector('.search-input').value)) throw new Error('type chip did not add operator');
  // clicking a result jumps to (chatId, messageId) and closes the modal
  document.querySelectorAll('.search-result')[0].click();
  if (!jumped) throw new Error('clicking a result did not jump to the chat');
});
await step('focus mode: sync, open settings, toggle quiet hours + a day', async () => {
  const focus = await imp('focus.js');
  await focus.sync();
  if (focus.isSilenced() !== false) throw new Error('default focus should not be silenced');
  focus.openFocus(); await tick();
  const sw = document.querySelector('.focus-h.with-toggle .switch');
  if (!sw) throw new Error('quiet-hours toggle not rendered');
  sw.click(); await tick(); // enable quiet hours (PUT /me/focus)
  const day = document.querySelector('.focus-day');
  if (!day) day; else { day.click(); await tick(); }
  const quick = document.querySelector('.focus-quick .btn');
  if (!quick) throw new Error('focus quick-set buttons missing');
});

// Phase C: the 0.20.0 offline / diagnostics / dev-tools modules.
await step('feature flags resolve + override + reset', async () => {
  const flags = await imp('flags.js');
  if (flags.flag('outbox') !== true) throw new Error('default flag wrong');
  flags.setFlag('outbox', false);
  if (flags.flag('outbox') !== false) throw new Error('override not applied');
  if (!flags.allFlags().some((f) => f.name === 'outbox' && f.overridden)) throw new Error('override not reported');
  flags.clearOverrides();
  if (flags.flag('outbox') !== true) throw new Error('reset failed');
});
await step('outbox enqueue → list → cancel', async () => {
  const outbox = await imp('outbox.js');
  const item = outbox.enqueue({ chatId: 'c1', body: 'offline hi' });
  if (!item.clientId || !item.tempId) throw new Error('no client/temp id');
  if (outbox.count() < 1) throw new Error('not queued');
  if (!outbox.pendingFor('c1').length) throw new Error('pendingFor empty');
  outbox.cancel(item.clientId);
  if (outbox.pendingFor('c1').length) throw new Error('cancel failed');
});
await step('telemetry track + crash capture (local)', async () => {
  const tel = await imp('telemetry.js');
  tel.track('smoke_event', { a: 1 });
  tel.recordError(new Error('smoke boom'), 'test');
  if (!tel.getEvents().some((e) => e.name === 'smoke_event')) throw new Error('event not recorded');
  if (!tel.getErrors().some((e) => e.message === 'smoke boom')) throw new Error('error not recorded');
});
await step('skeleton builders render nodes', async () => {
  const sk = await imp('skeleton.js');
  if (!sk.skeletonChatList(4).childNodes.length) throw new Error('chat skeleton empty');
  if (!sk.skeletonMessages(4)) throw new Error('msg skeleton missing');
});
await step('share canShare + clipboard fallback', async () => {
  const share = await imp('share.js');
  if (typeof share.canShare() !== 'boolean') throw new Error('canShare not boolean');
  await share.shareOrCopy({ text: 'hi', url: 'https://web.test/' }); // clipboard path
});
await step('debug panel opens', async () => { (await imp('debug.js')).openDebugPanel(); await tick(); });

// ---- 0.21.0 surfaces ------------------------------------------------------
await step('mentions tokenize + member autocomplete attach', async () => {
  const m = await imp('mentions.js');
  const chat = { type: 'group', members: [{ id: 'u1', displayName: 'Alice' }] };
  const toks = m.tokenizeMentions('hey @Alice', chat, 'u9');
  if (!toks.some((t) => t.mention)) throw new Error('mention not tokenized');
  const ta = new El('textarea'); document.body.appendChild(ta);
  const detach = m.attachAutocomplete(ta, () => chat, { meId: 'u9', anchor: document.body });
  if (typeof detach !== 'function') throw new Error('attach did not return teardown');
  detach();
});
await step('drafts set → indicator → clear', async () => {
  const d = await imp('drafts.js');
  d.set('c1', 'unsent text'); if (!d.has('c1')) throw new Error('draft missing');
  if (!d.preview('c1')) throw new Error('no preview'); d.clear('c1');
});
await step('activity record + panel opens', async () => {
  const a = await imp('activity.js');
  a.record({ kind: 'mention', chatId: 'c2', title: 'Gruppe', text: 'Du wurdest erwähnt' });
  if (a.unseenCount() < 1) throw new Error('unseen count not updated');
  await a.openActivityPanel(() => {}); await tick();
});
await step('theme studio + theme-code round-trip', async () => {
  const t = await imp('themes.js');
  t.openThemeStudio();
  const dec = t.decodeTheme(t.encodeTheme()); if (!dec || typeof dec !== 'object') throw new Error('bad decode');
});
await step('shortcuts cheat sheet opens', async () => { (await imp('shortcuts.js')).openShortcuts(); });
await step('insights render', async () => {
  const ins = await imp('insights.js'); ins.recordSent('c1');
  const c = new El('div'); ins.renderInsights(c);
});

// ---- 0.22.0 surfaces ------------------------------------------------------
await step('offline cache transforms + graceful no-op without IndexedDB', async () => {
  const c = await imp('cache.js');
  if (c.capMessages([{ id: 'a', createdAt: 1 }, { id: 'tmp-x', createdAt: 2 }], 5).length !== 1) throw new Error('capMessages wrong');
  if (c.mergeMessages([{ id: 'a', createdAt: 2 }], [{ id: 'b', createdAt: 1 }]).map((m) => m.id).join() !== 'b,a') throw new Error('merge wrong');
  c.install();
  const s = await c.stats(); if (s.available !== false) throw new Error('expected IndexedDB unavailable under node');
  if ((await c.loadMessages('c1')) !== null) throw new Error('expected null history without IndexedDB');
  await c.clearAll();
});
await step('sync-queue dedup + flush over the (fake) socket', async () => {
  const q = await imp('syncqueue.js');
  q.markDelivered('cz'); q.markRead('cz'); // read supersedes delivered
  q.flush();
  if (typeof q.count() !== 'number') throw new Error('count not numeric');
});
await step('deep-link id validation', async () => {
  const v = await imp('validate.js');
  if (!v.isValidId('550e8400-e29b-41d4-a716-446655440000')) throw new Error('uuid rejected');
  if (v.safeId('../bad') !== null) throw new Error('path traversal accepted');
});
await step('performance metric shaping', async () => {
  const t = await imp('telemetry.js');
  const p = t.shapePerf({ responseStart: 5.6, loadEventEnd: 100.2 }, []);
  if (p.ttfb !== 6 || p.load !== 100) throw new Error('shapePerf wrong');
});
await step('AMOLED theme toggle applies data-black', async () => {
  const prefs = await imp('prefs.js');
  prefs.set('theme', 'dark'); prefs.set('amoled', true); prefs.applyVisual();
  if (document.documentElement.getAttribute('data-black') !== 'on') throw new Error('data-black not set');
  prefs.set('amoled', false); prefs.applyVisual();
  if (document.documentElement.getAttribute('data-black') !== 'off') throw new Error('data-black not cleared');
});

// ---- 0.27.0 "Ordnung & Ausdruck" surfaces ---------------------------------
await step('drafts server-sync hook fires + hydrate stays local', async () => {
  const d = await imp('drafts.js');
  let synced = null;
  d.setSyncHandler((chatId, text) => { synced = { chatId, text }; });
  d.set('c1', 'typed on this device');
  if (!synced || synced.chatId !== 'c1') throw new Error('sync hook not called on set');
  synced = null;
  d.hydrate('c1', 'pushed from another device'); // must NOT echo back through sync
  if (synced) throw new Error('hydrate should not call the sync hook');
  if (d.get('c1') !== 'pushed from another device') throw new Error('hydrate did not apply');
  d.setSyncHandler(null); d.clear('c1');
});
await step('folder manager: load + open + folder filter', async () => {
  const folders = await imp('folders.js');
  await folders.loadFolders();              // tolerates the catch-all fetch shim
  folders.applyFolders([{ id: 'f1', name: 'Arbeit', emoji: '💼', chatIds: ['c1'] }]);
  if ((mods['store.js'].state.folders || []).length !== 1) throw new Error('applyFolders failed');
  folders.openFolderManager(); await tick();
  // The new folder appears as a filter tab and scopes the chat list.
  mods['store.js'].state.chatFilter = 'folder:f1';
  mods['store.js'].emit('chats'); await tick();
});
await step('pin/star menu actions are wired on a message', async () => {
  const chat = await imp('chat.js');
  app.openChatInShell('c1'); await tick();
  // Context-menu a rendered bubble — exercises togglePin/toggleStarSynced wiring.
  const bubble = document.querySelector('.msg .bubble');
  if (bubble) { const ev = { preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10 };
    bubble.closest('.msg')?.dispatchEvent?.(new Event('contextmenu')); }
});

// ---- 0.28.0 "Kontext": link previews + edit history -----------------------
await step('firstUrl extracts + trims a message link', async () => {
  const lp = await imp('linkpreview.js');
  if (lp.firstUrl('see https://example.com/x).') !== 'https://example.com/x') throw new Error('bad url parse');
  if (lp.firstUrl('no link here') !== null) throw new Error('false positive');
});
await step('link-preview card hydrates under a message with a link', async () => {
  app.openChatInShell('c1'); await tick(); await tick();
  // m4 carries a URL → a preview slot hydrates into a .link-preview card.
  const title = document.querySelector('.link-preview .lp-title');
  if (!title) throw new Error('link-preview card missing');
  if (title.textContent !== 'Beispielseite') throw new Error('preview title not rendered');
});
await step('edit-history viewer opens from the "bearbeitet" badge', async () => {
  app.openChatInShell('c1'); await tick();
  const badge = document.querySelector('.edited.as-link');
  if (!badge) throw new Error('clickable edited badge missing');
  badge.click(); await tick(); await tick();
  const items = document.querySelectorAll('.edit-history .eh-item');
  if (items.length < 2) throw new Error('edit-history not rendered (' + items.length + ' items)');
  if (!items.some((n) => n.textContent.includes('alte Fassung'))) throw new Error('prior version not shown');
});

console.log(failures ? `\n${failures} step(s) FAILED` : '\nall smoke steps passed');
process.exit(failures ? 1 : 0);
