/* status.js — ephemeral status updates ("Stories"): see your own + peers', post
   text (coloured background) or image updates, and a simple full-screen viewer
   that marks items seen. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, chatTime } from './ui.js';
import { pickFile } from './media.js';
import { uploadFile, authedObjectUrl } from './api.js';

const BG = ['#4d9bff', '#3fe0bd', '#ff8a5b', '#c084fc', '#f472b6', '#34d399', '#1f2937'];

export async function openStatus() {
  const m = modal({ title: 'Status', width: '460px', body: (b) =>
    b.append(el('div', { class: 'hint', text: 'Lade …' })) });
  let data;
  try { data = await api.get('/status'); }
  catch (e) { toast(e.message, 'err'); return; }
  render(m.body);

  function render(body) {
    clear(body);
    const me = store.state.me;
    const mineCount = data.mine?.length || 0;
    body.append(
      el('div', { class: 'urow', onClick: () => mineCount ? view(data.mine, 0) : addStatus(m, refresh) }, [
        (() => { const a = avatar(me, 50, { kind: 'user' });
          a.style.outline = mineCount ? '2.5px solid var(--accent)' : 'none';
          a.style.outlineOffset = '2px'; return a; })(),
        el('div', { class: 'meta' }, [
          el('div', { class: 'uname', text: 'Mein Status' }),
          el('div', { class: 'uabout', text: mineCount ? `${mineCount} Update(s)` : 'Tippe, um zu posten' }),
        ]),
        el('button', { class: 'iconbtn', title: 'Status hinzufügen',
          onClick: (e) => { e.stopPropagation(); addStatus(m, refresh); } }, icon('plus')),
      ]),
    );
    if (data.others?.length) {
      body.appendChild(el('div', { class: 'list-section', text: 'Letzte Updates' }));
      for (const grp of data.others) {
        const a = avatar(grp.user, 50, { kind: 'user', online: grp.user.online });
        if (grp.hasUnseen) { a.style.outline = '2.5px solid var(--accent)'; a.style.outlineOffset = '2px'; }
        body.appendChild(el('div', { class: 'urow', onClick: () => view(grp.items, 0) }, [
          a,
          el('div', { class: 'meta' }, [
            el('div', { class: 'uname', text: grp.user.displayName }),
            el('div', { class: 'uabout', text: chatTime(grp.updatedAt) }),
          ]),
        ]));
      }
    }
  }
  async function refresh() {
    try { data = await api.get('/status'); render(m.body); store.emit('chats'); } catch {}
  }
}

// ---- full-screen viewer ---------------------------------------------------
function view(items, start) {
  let i = start;
  const root = document.getElementById('call-root');
  const overlay = el('div', { class: 'call-overlay', style: { background: '#000' } });
  const content = el('div', { style: { position: 'relative', width: 'min(440px,92vw)',
    height: 'min(80vh,760px)', borderRadius: '14px', overflow: 'hidden', display: 'flex',
    alignItems: 'center', justifyContent: 'center' } });
  const bars = el('div', { style: { position: 'absolute', top: '10px', left: '10px', right: '10px',
    display: 'flex', gap: '4px', zIndex: '3' } });
  const closeBtn = el('button', { class: 'call-btn', style: { position: 'absolute', top: '18px',
    right: '18px', width: '44px', height: '44px', zIndex: '4' }, onClick: close }, icon('close'));
  overlay.append(content, closeBtn);
  content.append(bars);
  content.addEventListener('click', (e) => {
    const left = e.clientX - content.getBoundingClientRect().left < content.clientWidth / 2;
    left ? prev() : next();
  });
  root.appendChild(overlay);
  show();

  function show() {
    [...content.querySelectorAll('.status-body')].forEach((n) => n.remove());
    clear(bars);
    items.forEach((_, k) => bars.appendChild(el('div', { style: { flex: '1', height: '3px',
      borderRadius: '2px', background: k <= i ? '#fff' : 'rgba(255,255,255,.35)' } })));
    const it = items[i];
    const node = el('div', { class: 'status-body', style: { position: 'absolute', inset: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      textAlign: 'center', background: it.bgColor || '#111', color: '#fff', fontSize: '24px',
      fontWeight: '600' } });
    if (it.attachment) {
      node.style.background = '#000';
      const img = el('img', { style: { maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' } });
      authedObjectUrl(it.attachment.url).then((u) => u && (img.src = u));
      node.appendChild(it.attachment.kind === 'video'
        ? (() => { const v = el('video', { controls: 'controls', autoplay: 'autoplay',
            style: { maxWidth: '100%', maxHeight: '100%' } });
            authedObjectUrl(it.attachment.url).then((u) => u && (v.src = u)); return v; })()
        : img);
      if (it.body) node.appendChild(el('div', { style: { position: 'absolute', bottom: '20px',
        left: '20px', right: '20px', fontSize: '18px' }, text: it.body }));
    } else {
      node.textContent = it.body || '';
    }
    content.appendChild(node);
    if (it.id && !it.seen) api.post(`/status/${it.id}/view`).catch(() => {});
  }
  function next() { if (i < items.length - 1) { i++; show(); } else close(); }
  function prev() { if (i > 0) { i--; show(); } }
  function close() { overlay.remove(); }
}

// ---- compose --------------------------------------------------------------
function addStatus(parentModal, onDone) {
  let bg = BG[0];
  const text = el('textarea', { class: 'input', rows: '3', placeholder: 'Was gibt es Neues?' });
  const preview = el('div', { style: { borderRadius: '12px', minHeight: '120px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '20px',
    fontWeight: '600', background: bg, padding: '16px', textAlign: 'center', marginBottom: '12px' },
    text: 'Vorschau' });
  text.addEventListener('input', () => { preview.textContent = text.value || 'Vorschau'; });
  const swatches = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
    BG.map((c) => el('button', { style: { width: '30px', height: '30px', borderRadius: '50%',
      background: c, border: '0', cursor: 'pointer' }, onClick: () => { bg = c;
      preview.style.background = c; } })));

  const m = modal({
    title: 'Status hinzufügen',
    body: (b) => b.append(preview, swatches,
      el('div', { class: 'field' }, [el('label', { text: 'Text' }), text]),
      el('button', { class: 'btn block', onClick: postImage }, [icon('image'), 'Stattdessen Bild posten'])),
    foot: [el('button', { class: 'btn primary', onClick: postText }, 'Posten')],
  });
  async function postText() {
    if (!text.value.trim()) { toast('Schreib etwas.'); return; }
    try { await api.post('/status', { type: 'text', body: text.value.trim(), bgColor: bg });
      m.close(); toast('Status gepostet.', 'ok'); onDone && onDone(); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function postImage() {
    const file = await pickFile('image/*,video/*');
    if (!file) return;
    try {
      const meta = await uploadFile(file);
      await api.post('/status', { type: meta.kind === 'video' ? 'video' : 'image',
        body: text.value.trim(),
        attachment: { url: meta.url, mime: meta.mime, name: meta.name, size: meta.size, kind: meta.kind } });
      m.close(); toast('Status gepostet.', 'ok'); onDone && onDone();
    } catch (e) { toast(e.message, 'err'); }
  }
}
