/* media.js — attachments: pick files, upload them, send them as messages, and
   render received attachments (images, gifs, video, audio/voice, files). All
   binary fetches go through authed blob: URLs because /api/uploads is gated. */

import { api, uploadFile, authedObjectUrl, getToken } from './api.js';
import { el, icon, fileSize, toast, modal } from './ui.js';

export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

export function imageDims(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve({});
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Upload [file] and post it as a message in [chatId]. Optional text caption and
// replyTo. Returns the created message (also pushed over the socket).
export async function sendAttachment(chatId, file, { caption = '', replyTo = null } = {}) {
  const meta = await uploadFile(file);
  const dims = await imageDims(file);
  const type = meta.kind === 'gif' ? 'gif' : meta.kind;
  const body = {
    type,
    attachment: {
      url: meta.url, mime: meta.mime, name: meta.name, size: meta.size, kind: meta.kind,
      ...(dims.width ? { width: dims.width, height: dims.height } : {}),
    },
  };
  if (caption) body.body = caption;
  if (replyTo) body.replyTo = replyTo;
  const r = await api.post(`/chats/${chatId}/messages`, body);
  return r.message;
}

// Render an attachment object into a DOM node for a bubble.
export function renderAttachment(att, { onImageClick } = {}) {
  if (!att) return null;
  const kind = att.kind || 'file';

  if (kind === 'image' || kind === 'gif') {
    const img = el('img', { class: 'att-img', alt: att.name || '' });
    if (att.width && att.height) {
      img.style.aspectRatio = `${att.width} / ${att.height}`;
      img.style.width = Math.min(320, att.width) + 'px';
    }
    authedObjectUrl(att.url).then((u) => { if (u) img.src = u; });
    img.addEventListener('click', () => onImageClick ? onImageClick(att) : openLightbox(att));
    return img;
  }
  if (kind === 'video') {
    const v = el('video', { class: '', controls: 'controls', preload: 'metadata' });
    const wrap = el('div', { class: 'att-video' }, v);
    authedObjectUrl(att.url).then((u) => { if (u) v.src = u; });
    return wrap;
  }
  if (kind === 'audio' || kind === 'voice') {
    const a = el('audio', { controls: 'controls', preload: 'metadata' });
    const wrap = el('div', { class: 'att-audio' }, a);
    authedObjectUrl(att.url).then((u) => { if (u) a.src = u; });
    return wrap;
  }
  // generic file
  return el('div', { class: 'att-file', onClick: () => downloadFile(att) }, [
    icon('file'),
    el('div', { class: 'fmeta' }, [
      el('div', { class: 'fname', text: att.name || 'Datei' }),
      el('div', { class: 'fsize', text: fileSize(att.size) }),
    ]),
    icon('download', 'sm'),
  ]);
}

async function downloadFile(att) {
  try {
    const res = await fetch(att.url, { headers: { Authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const a = el('a', { href: u, download: att.name || 'datei' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  } catch { toast('Download fehlgeschlagen.', 'err'); }
}

function openLightbox(att) {
  const img = el('img', { style: { maxWidth: '90vw', maxHeight: '86vh', borderRadius: '10px' } });
  authedObjectUrl(att.url).then((u) => { if (u) img.src = u; });
  const back = el('div', { class: 'modal-back', onClick: () => back.remove() }, img);
  document.getElementById('modal-root').appendChild(back);
}
