/* ui.js — DOM helpers, icon set, avatars, time formatting, toasts, modals, menus.
   Pure helpers shared by every view. No app state lives here. */

// ---- icons (stroked line set, currentColor) -------------------------------
const PATHS = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  menu: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  back: 'M19 12H5M12 19l-7-7 7-7',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  attach: 'M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8',
  emoji: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  video: 'M23 7l-7 5 7 5V7ZM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  videoOff: 'M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2M23 7l-7 5M1 1l22 22',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M20 6 9 17l-5-5',
  doublecheck: 'M2 12.5 7 17l3.5-3.5M11 17 22 6M7.5 12.5 10 15',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  image: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 16l-5-5L5 21',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2v11ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  group: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  status: 'M12 22a10 10 0 1 0 0-20M12 2a10 10 0 0 0-7 17',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  reply: 'M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  react: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  plus: 'M12 5v14M5 12h14',
  qr: 'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h3v3h-3zM20 14v6M17 20h3',
  mute: 'M11 5 6 9H2v6h4l5 4V5ZM23 9l-6 6M17 9l6 6',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  pin: 'M12 17v5M9 3h6l-1 7 3 3H7l3-3-1-7Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-4M12 8h.01',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  micOff: 'M1 1l22 22M9 9v3a3 3 0 0 0 5 2M15 9.3V6a3 3 0 0 0-5.9-.7M19 11a7 7 0 0 1-1 3.5M12 18.9V21',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4',
  chat: 'M21 11.5a8.4 8.4 0 0 1-12 7.5L3 21l2-6a8.4 8.4 0 1 1 16-3.5Z',
  forward: 'M15 17l5-5-5-5M20 12H9a5 5 0 0 0-5 5v2',
  star: 'M12 3l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.5 9.9l6.6-1L12 3Z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  palette: 'M12 21a9 9 0 1 1 0-18c4.9 0 9 3.6 9 8 0 3-2.5 4-4 4h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 21ZM7.5 11.5h.01M10.5 7.5h.01M14.5 7.5h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  stop: 'M7 7h10v10H7z',
  play: 'M7 4l13 8-13 8V4Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  chevron: 'M9 6l6 6-6 6',
  callIn: 'M16 2v6h6M16 8l6-6M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  callOut: 'M23 7V1h-6M23 1l-6 6M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  callMissed: 'M23 1l-6 6-4-4M17 1h6v6M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
  copy: 'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  schedule: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  paint: 'M19 11V7a2 2 0 0 0-2-2h-1V3H8v2H7a2 2 0 0 0-2 2v4h14ZM5 11v3a2 2 0 0 0 2 2h4v3a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-3a2 2 0 0 0 2-2v-3',
  unblock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12l3 3 5-6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  poll: 'M7 16v-5M12 16V8M17 16v-3M4 21h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1Z',
  // Channels / Communities (0.31.0): a compass for "Entdecken", a megaphone for
  // the broadcast badge, and a hash for handles.
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1ZM14 8a4 4 0 0 1 0 8M16.5 5a8 8 0 0 1 0 14',
  hash: 'M9 4 7 20M17 4l-2 16M5 9h15M4 15h15',
  // Identität & Schutz (0.32.0): a key for two-factor/recovery codes.
  key: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v3H2v-4l6.1-6.1A4 4 0 0 1 15 7Zm1.5 1.5h.01',
  // Pläne & Aufgaben (0.33.0): a calendar for "Termine", a checklist for tasks.
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  tasks: 'M4 6l1.5 1.5L8 4M4 12l1.5 1.5L8 10M4 18l1.5 1.5L8 16M11 5h9M11 11h9M11 17h9',
  // Ausdruck & Werkbank (0.35.0): chevrons for code, a card for contacts.
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  card: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM7 10h4M7 14h7M16 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
};

export function icon(name, cls = '') {
  const d = PATHS[name] || '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

// ---- element builder ------------------------------------------------------
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const clear = (node) => { if (node) node.replaceChildren(); return node; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---- avatars --------------------------------------------------------------
const AV_COLORS = ['#4d9bff', '#3fe0bd', '#ff8a5b', '#c084fc', '#f472b6',
  '#fbbf24', '#34d399', '#60a5fa', '#f87171', '#a3e635'];

// app.js injects a resolver (path, version) -> Promise<blobURL|null> so this
// module can show auth-gated images without depending on api.js directly.
let imageResolver = null;
export function setImageResolver(fn) { imageResolver = fn; }

export function initials(name) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFor(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// Build an avatar element. `entity` = { id, displayName, title, avatarColor,
//   hasAvatar, avatarVersion } or a chat. `kind` chooses the image endpoint.
export function avatar(entity, size = 44, { online = null, kind = 'user' } = {}) {
  const name = entity?.displayName || entity?.title || entity?.name || '?';
  const color = entity?.avatarColor || colorFor(entity?.id || name);
  const a = el('div', {
    class: 'av',
    style: {
      width: size + 'px', height: size + 'px',
      fontSize: Math.round(size * 0.38) + 'px',
      background: color,
    },
  });
  a.textContent = initials(name);
  if (entity?.hasAvatar && entity?.id && imageResolver) {
    const path = kind === 'chat'
      ? `/chats/${entity.id}/avatar`
      : `/users/${entity.id}/avatar`;
    imageResolver(path, entity.avatarVersion || 0).then((url) => {
      if (!url) return;
      a.style.background = '#000';
      a.textContent = '';
      a.appendChild(el('img', { src: url, alt: '' }));
    }).catch(() => {});
  }
  if (online === true) a.appendChild(el('span', { class: 'dot' }));
  return a;
}

// ---- time -----------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export function timeOf(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (same(d, today)) return 'Heute';
  if (same(d, yest)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year:
    d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
export function chatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(ts);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Gestern';
  const days = (now - d) / 86400000;
  if (days < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
export function lastSeenLabel(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'gerade eben online';
  if (mins < 60) return `zuletzt online vor ${mins} Min.`;
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return `zuletzt online um ${timeOf(ts)}`;
  return `zuletzt online am ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
}
export function fileSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// ---- toasts ---------------------------------------------------------------
export function toast(msg, kind = '') {
  const root = document.getElementById('toasts');
  const t = el('div', { class: `toast ${kind}`.trim(), text: msg });
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s';
    setTimeout(() => t.remove(), 260); }, 3200);
}

// ---- modal ----------------------------------------------------------------
// modal({ title, body(node), foot:[buttons], onClose }) → { close }
export function modal({ title, body, foot = [], width, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { back.remove(); onClose && onClose(); };
  const head = el('div', { class: 'modal-head' }, [
    el('h3', { text: title || '' }),
    el('button', { class: 'iconbtn', onClick: close }, icon('close')),
  ]);
  const bodyNode = el('div', { class: 'modal-body' });
  if (typeof body === 'function') body(bodyNode); else if (body) bodyNode.append(body);
  const box = el('div', { class: 'modal', style: width ? { maxWidth: width } : {} },
    [head, bodyNode]);
  if (foot.length) box.appendChild(el('div', { class: 'modal-foot' }, foot));
  const back = el('div', { class: 'modal-back', onClick: (e) => {
    if (e.target === back) close();
  } }, box);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  root.appendChild(back);
  return { close, body: bodyNode };
}

export function confirmModal({ title, message, confirmText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: el('p', { class: 'hint', style: { fontSize: '15px', lineHeight: '1.5' },
        text: message }),
      foot: [
        el('button', { class: 'btn ghost', onClick: () => { m.close(); resolve(false); } },
          'Abbrechen'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`,
          onClick: () => { m.close(); resolve(true); } }, confirmText),
      ],
    });
  });
}

// ---- context menu ---------------------------------------------------------
// openMenu(anchorEvent, items[{label, icon, danger, onClick}|{sep:true}])
export function openMenu(ev, items) {
  ev.preventDefault(); ev.stopPropagation();
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.appendChild(el('div', { class: 'sep' })); continue; }
    const b = el('button', { class: it.danger ? 'danger' : '', onClick: () => {
      menu.remove(); it.onClick && it.onClick();
    } }, [it.icon ? icon(it.icon) : null, el('span', { text: it.label })]);
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  let x = ev.clientX, y = ev.clientY;
  if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
  if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
  menu.style.left = Math.max(8, x) + 'px';
  menu.style.top = Math.max(8, y) + 'px';
  setTimeout(() => {
    document.addEventListener('click', function off() {
      menu.remove(); document.removeEventListener('click', off);
    });
  }, 0);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- reusable controls ----------------------------------------------------
// A toggle switch. onChange(next) may be async; if it throws, the switch flips
// back. Returns the button element.
export function switchEl(on, onChange) {
  const sw = el('button', { class: `switch ${on ? 'on' : ''}`,
    role: 'switch', 'aria-checked': on ? 'true' : 'false' }, el('i'));
  let cur = !!on;
  sw.addEventListener('click', async () => {
    const next = !cur;
    cur = next;
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    try { await onChange(next); }
    catch (e) {
      cur = !next;
      sw.classList.toggle('on', cur);
      sw.setAttribute('aria-checked', cur ? 'true' : 'false');
      toast(e.message || 'Fehler', 'err');
    }
  });
  return sw;
}

// A settings/list row: icon tile + title + optional subtitle + trailing control.
export function setRow(iconName, title, { sub = null, trailing = null, onClick = null } = {}) {
  const row = el('div', { class: `set-row ${onClick ? 'clickable' : ''}`, onClick }, [
    el('div', { class: 'set-ic' }, icon(iconName, 'sm')),
    el('div', { class: 'set-main' }, [
      el('div', { class: 'set-title', text: title }),
      sub != null ? el('div', { class: 'set-sub', text: sub }) : null,
    ].filter(Boolean)),
    trailing,
  ].filter(Boolean));
  return row;
}
