/* gallery.js — full-screen media viewer. Steps through a chat's images and
   videos with arrows / a thumbnail strip, zooms images on click, plays videos,
   and downloads the original. Replaces the old single-image lightbox in
   media.js. All binaries load through authed blob: URLs (see api.js). */

import { authedObjectUrl, getToken } from './api.js';
import { el, clear, icon, toast } from './ui.js';

let host = null;

export function closeGallery() {
  if (!host) return;
  host.remove(); host = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (!host) return;
  if (e.key === 'Escape') { e.preventDefault(); closeGallery(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); host.go(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); host.go(1); }
}

// openGallery(items, startIndex) — items are attachment objects {url, kind, name}.
export function openGallery(items, startIndex = 0) {
  closeGallery();
  const media = (items || []).filter((a) => a && ['image', 'gif', 'video'].includes(a.kind));
  if (!media.length) return;
  let idx = Math.max(0, Math.min(startIndex, media.length - 1));
  let zoomed = false;

  const title = el('div', { class: 'g-title' });
  const stageMedia = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%', maxHeight: '100%' } });
  const prevIco = icon('back');
  const nextIco = icon('back'); nextIco.style.transform = 'scaleX(-1)';
  const prev = el('button', { class: 'gallery-nav prev', title: 'Zurück', onClick: () => go(-1) }, prevIco);
  const next = el('button', { class: 'gallery-nav next', title: 'Weiter', onClick: () => go(1) }, nextIco);
  const stage = el('div', { class: 'gallery-stage' }, [prev, stageMedia, next]);
  const strip = el('div', { class: 'gallery-strip' });

  const head = el('div', { class: 'gallery-head' }, [
    title,
    el('button', { class: 'iconbtn', title: 'Herunterladen', onClick: download }, icon('download')),
    el('button', { class: 'iconbtn', title: 'Schließen', onClick: closeGallery }, icon('close')),
  ]);
  host = el('div', { class: 'gallery', onClick: (e) => { if (e.target === host || e.target === stage) closeGallery(); } },
    [head, stage, strip]);
  host.go = go;
  document.getElementById('modal-root').appendChild(host);
  document.addEventListener('keydown', onKey, true);

  // Thumbnail strip (built once).
  const thumbs = media.map((att, i) => {
    const t = el('img', { alt: '', onClick: () => { idx = i; render(); } });
    authedObjectUrl(att.url).then((u) => { if (u) t.src = u; });
    strip.append(t);
    return t;
  });
  if (media.length < 2) { prev.style.display = 'none'; next.style.display = 'none'; strip.style.display = 'none'; }

  function go(delta) { idx = (idx + delta + media.length) % media.length; zoomed = false; render(); }

  function render() {
    const att = media[idx];
    clear(stageMedia);
    title.textContent = `${att.name || 'Medien'} · ${idx + 1}/${media.length}`;
    if (att.kind === 'video') {
      const v = el('video', { controls: 'controls', autoplay: 'autoplay', style: { maxWidth: '94vw', maxHeight: '78vh' } });
      authedObjectUrl(att.url).then((u) => { if (u) v.src = u; });
      stageMedia.append(v);
    } else {
      const img = el('img', { alt: att.name || '' });
      authedObjectUrl(att.url).then((u) => { if (u) img.src = u; });
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomed = !zoomed;
        img.style.transform = zoomed ? 'scale(2)' : '';
        img.style.cursor = zoomed ? 'zoom-out' : 'zoom-in';
      });
      stageMedia.append(img);
    }
    thumbs.forEach((t, i) => t.classList.toggle('on', i === idx));
    thumbs[idx]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  async function download() {
    const att = media[idx];
    try {
      const res = await fetch(att.url, { headers: { Authorization: `Bearer ${getToken()}` } });
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = el('a', { href: u, download: att.name || 'medien' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    } catch { toast('Download fehlgeschlagen.', 'err'); }
  }

  render();
}
