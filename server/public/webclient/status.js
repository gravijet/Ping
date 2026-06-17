/* status.js — ephemeral status updates ("Stories") rendered as a list-pane
   section: your own updates, peers' updates, a full-screen viewer that marks
   items seen, a composer (coloured text card or image/video) and — for your
   own — a viewers list and delete. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, chatTime } from './ui.js';
import { pickFile } from './media.js';
import { uploadFile, authedObjectUrl } from './api.js';
import { setNavBadge } from './app.js';

const BG = ['#4d9bff', '#7b6cff', '#3fe0bd', '#ff8a5b', '#f472b6', '#34d399', '#1f2937'];
let paneBody = null;
let data = { mine: [], others: [] };

export async function renderStatusPane(head, body) {
  paneBody = body;
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Status' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Status hinzufügen', onClick: () => addStatus(refresh) }, icon('plus')),
    ]),
  );
  clear(body).append(el('div', { class: 'pane-empty', text: 'Lade …' }));
  await refresh();
}

async function refresh() {
  try { data = await api.get('/status'); } catch (e) { toast(e.message, 'err'); return; }
  setNavBadge('status', (data.others || []).filter((g) => g.hasUnseen).length);
  if (paneBody) paint(paneBody);
}

function paint(body) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.appendChild(scroll);
  const me = store.state.me;
  const mineCount = data.mine?.length || 0;

  const myAv = avatar(me, 50, { kind: 'user' });
  const myRing = el('div', { class: `status-ring ${mineCount ? 'mine' : ''}` }, myAv);
  scroll.appendChild(el('button', { class: 'urow',
    onClick: () => mineCount ? view(data.mine, 0, true) : addStatus(refresh) }, [
    myRing,
    el('div', { class: 'meta' }, [
      el('div', { class: 'uname', text: 'Mein Status' }),
      el('div', { class: 'uabout', text: mineCount ? `${mineCount} Update(s) · zum Ansehen tippen` : 'Tippe, um zu posten' }),
    ]),
    el('span', { class: 'iconbtn', title: 'Hinzufügen',
      onClick: (e) => { e.stopPropagation(); addStatus(refresh); } }, icon('plus')),
  ]));

  if (data.others?.length) {
    scroll.appendChild(el('div', { class: 'pane-section' }, [icon('status'), el('span', { text: 'Letzte Updates' })]));
    for (const grp of data.others) {
      const a = avatar(grp.user, 50, { kind: 'user', online: grp.user.online });
      const ring = el('div', { class: `status-ring ${grp.hasUnseen ? 'unseen' : ''}` }, a);
      scroll.appendChild(el('button', { class: 'urow', onClick: () => view(grp.items, 0, false) }, [
        ring,
        el('div', { class: 'meta' }, [
          el('div', { class: 'uname', text: grp.user.displayName }),
          el('div', { class: 'uabout', text: chatTime(grp.updatedAt) }),
        ]),
      ]));
    }
  } else {
    scroll.appendChild(el('div', { class: 'pane-empty', text: 'Noch keine Status-Updates deiner Kontakte.' }));
  }
}

// ---- full-screen viewer ---------------------------------------------------
function view(items, start, mine) {
  let i = start;
  const root = document.getElementById('call-root');
  const overlay = el('div', { class: 'call-overlay', style: { background: '#000' } });
  const content = el('div', { style: { position: 'relative', width: 'min(440px,92vw)',
    height: 'min(80vh,760px)', borderRadius: '16px', overflow: 'hidden', display: 'flex',
    alignItems: 'center', justifyContent: 'center' } });
  const bars = el('div', { style: { position: 'absolute', top: '10px', left: '10px', right: '10px',
    display: 'flex', gap: '4px', zIndex: '3' } });
  const topBtns = el('div', { style: { position: 'absolute', top: '16px', right: '16px',
    display: 'flex', gap: '8px', zIndex: '4' } });
  if (mine) {
    topBtns.append(
      el('button', { class: 'call-btn', style: { width: '42px', height: '42px' },
        onClick: (e) => { e.stopPropagation(); showViewers(items[i]); } }, icon('eye')),
      el('button', { class: 'call-btn', style: { width: '42px', height: '42px' },
        onClick: (e) => { e.stopPropagation(); delItem(items[i]); } }, icon('trash')),
    );
  }
  topBtns.append(el('button', { class: 'call-btn', style: { width: '42px', height: '42px' }, onClick: close }, icon('close')));
  overlay.append(content);
  content.append(bars);
  overlay.append(topBtns);
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
      const media = it.attachment.kind === 'video'
        ? (() => { const v = el('video', { controls: 'controls', autoplay: 'autoplay',
            style: { maxWidth: '100%', maxHeight: '100%' } });
            authedObjectUrl(it.attachment.url).then((u) => u && (v.src = u)); return v; })()
        : (() => { const img = el('img', { style: { maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' } });
            authedObjectUrl(it.attachment.url).then((u) => u && (img.src = u)); return img; })();
      node.appendChild(media);
      if (it.body) node.appendChild(el('div', { style: { position: 'absolute', bottom: '20px',
        left: '20px', right: '20px', fontSize: '18px' }, text: it.body }));
    } else { node.textContent = it.body || ''; }
    content.appendChild(node);
    if (it.id && !it.seen && !mine) api.post(`/status/${it.id}/view`).catch(() => {});
  }
  function next() { if (i < items.length - 1) { i++; show(); } else close(); }
  function prev() { if (i > 0) { i--; show(); } }
  function close() { overlay.remove(); refresh(); }
  async function delItem(it) {
    if (!it?.id) return;
    try { await api.del(`/status/${it.id}`); toast('Status gelöscht.', 'ok');
      items.splice(i, 1); if (!items.length) return close();
      i = Math.min(i, items.length - 1); show(); }
    catch (e) { toast(e.message, 'err'); }
  }
}

async function showViewers(it) {
  if (!it?.id) return;
  const mdl = modal({ title: 'Betrachter', body: (b) => b.append(el('div', { class: 'hint', text: 'Lade …' })) });
  try {
    const { viewers } = await api.get(`/status/${it.id}/viewers`);
    clear(mdl.body);
    if (!viewers?.length) { mdl.body.append(el('div', { class: 'pane-empty', text: 'Noch niemand.' })); return; }
    for (const v of viewers) mdl.body.append(el('div', { class: 'urow' }, [
      avatar(v.user || v, 42, { kind: 'user' }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: (v.user || v).displayName }),
        v.viewedAt ? el('div', { class: 'uabout', text: new Date(v.viewedAt).toLocaleString('de-DE') }) : null,
      ].filter(Boolean)),
    ]));
  } catch (e) { clear(mdl.body); mdl.body.append(el('div', { class: 'formerr', text: e.message })); }
}

// ---- compose --------------------------------------------------------------
function addStatus(onDone) {
  let bg = BG[0];
  const text = el('textarea', { class: 'input', rows: '3', placeholder: 'Was gibt es Neues?' });
  const preview = el('div', { style: { borderRadius: '14px', minHeight: '130px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '20px',
    fontWeight: '600', background: bg, padding: '16px', textAlign: 'center', marginBottom: '12px' },
    text: 'Vorschau' });
  text.addEventListener('input', () => { preview.textContent = text.value || 'Vorschau'; });
  const swatches = el('div', { class: 'swatches' },
    BG.map((c) => el('button', { class: 'swatch', style: { background: c },
      onClick: () => { bg = c; preview.style.background = c; } })));

  const m = modal({
    title: 'Status hinzufügen',
    body: (b) => b.append(preview, swatches,
      el('div', { class: 'field' }, [el('label', { text: 'Text' }), text]),
      el('button', { class: 'btn block', onClick: postImage }, [icon('image'), 'Stattdessen Bild/Video posten'])),
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
