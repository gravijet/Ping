/* draw.js — sketch a quick drawing and send it as an image (parity with the
   native sticker-draw screen). Plain canvas: brush colour + size, eraser, clear.
   Exports a PNG and reuses media.sendAttachment to post it. */

import { el, icon, modal, toast } from './ui.js';
import { sendAttachment } from './media.js';

const COLORS = ['#111827', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export function drawModal(chatId) {
  let color = '#111827';
  let size = 6;
  let drawing = false;
  let last = null;

  const canvas = el('canvas', { class: 'draw-canvas', width: '720', height: '540' });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  const start = (e) => { e.preventDefault(); drawing = true; last = pos(e); canvas.setPointerCapture?.(e.pointerId); };
  const move = (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = color; ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  };
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);

  const colorsBox = el('div', { class: 'draw-colors' }, COLORS.map((c) =>
    el('button', { class: `draw-color ${c === color ? 'on' : ''}`, style: { background: c },
      onClick: (e) => { color = c; colorsBox.querySelectorAll('.draw-color').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const sizeInput = el('input', { type: 'range', min: '2', max: '28', value: String(size),
    oninput: (e) => { size = Number(e.target.value); } });
  const eraser = el('button', { class: 'btn sm', title: 'Radierer', onClick: () => { color = '#ffffff'; colorsBox.querySelectorAll('.draw-color').forEach((b) => b.classList.remove('on')); } }, [icon('trash'), 'Radierer']);
  const clearBtn = el('button', { class: 'btn sm ghost', onClick: () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } }, 'Leeren');

  const m = modal({
    title: 'Zeichnen', width: '560px',
    body: (b) => b.append(el('div', { class: 'draw-wrap' }, [
      canvas,
      el('div', { class: 'draw-tools' }, [
        colorsBox,
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [icon('edit', 'sm'), sizeInput]),
        eraser, clearBtn,
      ]),
    ])),
    foot: [el('button', { class: 'btn primary', onClick: send }, [icon('send'), 'Senden'])],
  });

  function send() {
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('Zeichnung konnte nicht erstellt werden.', 'err'); return; }
      const file = new File([blob], `zeichnung-${Date.now()}.png`, { type: 'image/png' });
      try { await sendAttachment(chatId, file); m.close(); }
      catch (e) { toast(e.message || 'Senden fehlgeschlagen', 'err'); }
    }, 'image/png');
  }
}
