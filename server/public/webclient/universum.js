/* universum.js — 0.38.0 "Universum" mega-release client.
   Render cards + create modals for the ten new structured/media message types
   (whiteboard, doc, playlist, recipe, flashcards, form, bookmark, place,
   videonote, watchparty) plus virtual gifts. Mirrors the events.js pattern:
   a create modal POSTs; the new/updated message rides back over the socket.
   Interactions POST and let message-updated re-render. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';

const activeChat = (m) => m.chatId || store.state.activeId;
const esc = (s) => String(s == null ? '' : s);

// Small helper: a labelled text/number field.
function field(label, input) {
  return el('div', { class: 'field' }, [el('label', { text: label }), input]);
}

// ════════════════════════════════════════════════════════════════════════
// Whiteboard
// ════════════════════════════════════════════════════════════════════════
export function renderWhiteboard(m) {
  const wb = m.whiteboard || { strokes: [] };
  const card = el('div', { class: 'uni-card whiteboard-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('paint', 'sm'), el('span', { text: wb.title || 'Whiteboard' })]));
  const W = 280, H = 180;
  const box = el('div', { class: 'wb-preview' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'wb-svg');
  const draw = (stroke) => {
    if (!stroke.points || stroke.points.length < 1) return;
    const d = stroke.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', stroke.color || '#222');
    path.setAttribute('stroke-width', String(stroke.width || 3));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  };
  (wb.strokes || []).forEach(draw);
  box.append(svg);
  card.append(box);
  // Live strokes from other drawers.
  const onStroke = (p) => { if (p.messageId === m.id) draw(p.stroke); };
  const onCleared = (p) => { if (p.messageId === m.id) clear(svg); };
  store.on('whiteboard-stroke', onStroke);
  store.on('whiteboard-cleared', onCleared);
  card.append(el('div', { class: 'uni-actions' }, [
    el('button', { class: 'btn small', onClick: () => openDrawBoard(m) }, 'Zeichnen'),
  ]));
  return card;
}

// A simple full-screen draw surface; each finished stroke POSTs immediately.
function openDrawBoard(m) {
  const chatId = activeChat(m);
  const color = el('input', { type: 'color', value: '#e23' });
  const canvas = el('canvas', { class: 'wb-canvas', width: '600', height: '380' });
  const ctx = canvas.getContext('2d');
  const wb = m.whiteboard || { strokes: [] };
  const scaleX = 600 / 280, scaleY = 380 / 180;
  const repaint = () => {
    ctx.clearRect(0, 0, 600, 380);
    for (const s of wb.strokes || []) strokePath(s);
  };
  function strokePath(s) {
    if (!s.points?.length) return;
    ctx.beginPath();
    ctx.strokeStyle = s.color || '#222';
    ctx.lineWidth = (s.width || 3) * scaleX;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    s.points.forEach((p, i) => { const x = p[0] * scaleX, y = p[1] * scaleY; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  repaint();
  let drawing = false; let pts = [];
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return [Math.round((cx / r.width) * 280), Math.round((cy / r.height) * 180)];
  };
  const start = (e) => { drawing = true; pts = [pos(e)]; e.preventDefault(); };
  const move = (e) => { if (!drawing) return; pts.push(pos(e)); const s = { color: color.value, width: 3, points: pts }; repaint(); strokePath({ ...s, points: pts.map((p) => p) }); };
  const end = async () => {
    if (!drawing) return; drawing = false;
    if (pts.length < 2) return;
    const stroke = { color: color.value, width: 3, points: pts };
    (wb.strokes ||= []).push(stroke);
    try { await api.post(`/chats/${chatId}/messages/${m.id}/whiteboard/stroke`, stroke); } catch (e) { toast(e.message || 'Fehler', 'err'); }
  };
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);
  modal({
    title: 'Whiteboard',
    body: (b) => b.append(el('div', { class: 'wb-tools' }, [el('label', { text: 'Farbe' }), color,
      el('button', { class: 'btn small', onClick: async () => { try { await api.post(`/chats/${chatId}/messages/${m.id}/whiteboard/clear`, {}); wb.strokes = []; repaint(); } catch {} } }, 'Leeren')]), canvas),
    foot: [el('button', { class: 'btn primary', onClick: () => store.emit('close-modals') }, 'Fertig')],
  });
}

export function newWhiteboardModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel (optional)', maxlength: '140' });
  const m = modal({
    title: 'Whiteboard starten',
    body: (b) => b.append(field('Titel', title)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      try { await api.post(`/chats/${chatId}/whiteboard`, { title: title.value.trim() }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Starten')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Collaborative doc
// ════════════════════════════════════════════════════════════════════════
export function renderDoc(m) {
  const doc = m.doc || {};
  const card = el('div', { class: 'uni-card doc-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('file', 'sm'), el('span', { text: doc.title || 'Dokument' }),
    el('span', { class: 'uni-badge', text: 'v' + (doc.version || 1) })]));
  const preview = (doc.body || '').slice(0, 280);
  card.append(el('div', { class: 'doc-preview', text: preview || '(leer)' }));
  card.append(el('div', { class: 'uni-actions' }, [el('button', { class: 'btn small', onClick: () => openDocEditor(m) }, 'Bearbeiten')]));
  return card;
}

function openDocEditor(m) {
  const chatId = activeChat(m);
  const doc = m.doc || {};
  const title = el('input', { class: 'input', value: doc.title || '', placeholder: 'Titel' });
  const body = el('textarea', { class: 'input', rows: '12', value: doc.body || '' });
  const err = el('div', { class: 'formerr' });
  const md = modal({
    title: 'Dokument bearbeiten',
    body: (b) => b.append(field('Titel', title), field('Inhalt', body), err),
    foot: [el('button', { class: 'btn primary', onClick: save }, 'Speichern')],
  });
  async function save() {
    try {
      await api.post(`/chats/${chatId}/messages/${m.id}/doc`, { title: title.value, body: body.value, baseVersion: doc.version });
      md.close();
    } catch (e) { err.textContent = e.message || 'Konflikt — bitte neu laden.'; }
  }
}

export function newDocModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel', maxlength: '140' });
  const body = el('textarea', { class: 'input', rows: '6', placeholder: 'Inhalt …' });
  const m = modal({
    title: 'Dokument erstellen',
    body: (b) => b.append(field('Titel', title), field('Inhalt', body)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      try { await api.post(`/chats/${chatId}/doc`, { title: title.value.trim(), body: body.value }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Playlist
// ════════════════════════════════════════════════════════════════════════
export function renderPlaylist(m) {
  const pl = m.playlist || { tracks: [] };
  const card = el('div', { class: 'uni-card playlist-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('music', 'sm'), el('span', { text: pl.title || 'Playlist' }),
    el('span', { class: 'uni-badge', text: (pl.tracks?.length || 0) + ' Titel' })]));
  const list = el('ol', { class: 'pl-tracks' });
  for (const t of pl.tracks || []) {
    const row = el('li', {}, [
      t.url ? el('a', { href: t.url, target: '_blank', rel: 'noopener', class: 'pl-title', text: t.title })
            : el('span', { class: 'pl-title', text: t.title }),
      t.artist ? el('span', { class: 'pl-artist', text: ' · ' + t.artist }) : null,
    ].filter(Boolean));
    list.append(row);
  }
  card.append(list);
  card.append(el('div', { class: 'uni-actions' }, [el('button', { class: 'btn small', onClick: () => addTrackModal(m) }, '+ Titel')]));
  return card;
}

function addTrackModal(m) {
  const chatId = activeChat(m);
  const title = el('input', { class: 'input', placeholder: 'Titel' });
  const artist = el('input', { class: 'input', placeholder: 'Interpret (optional)' });
  const url = el('input', { class: 'input', placeholder: 'Link (optional)' });
  const md = modal({
    title: 'Titel hinzufügen',
    body: (b) => b.append(field('Titel', title), field('Interpret', artist), field('Link', url)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!title.value.trim()) return;
      try { await api.post(`/chats/${chatId}/messages/${m.id}/playlist/tracks`, { title: title.value.trim(), artist: artist.value.trim(), url: url.value.trim() }); md.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Hinzufügen')],
  });
}

export function newPlaylistModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Playlist-Name', maxlength: '140' });
  const first = el('input', { class: 'input', placeholder: 'Erster Titel (optional)' });
  const m = modal({
    title: 'Playlist erstellen',
    body: (b) => b.append(field('Name', title), field('Erster Titel', first)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!title.value.trim()) return;
      const tracks = first.value.trim() ? [{ title: first.value.trim() }] : [];
      try { await api.post(`/chats/${chatId}/playlist`, { title: title.value.trim(), tracks }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Recipe
// ════════════════════════════════════════════════════════════════════════
export function renderRecipe(m) {
  const r = m.recipe || {};
  const card = el('div', { class: 'uni-card recipe-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('file', 'sm'), el('span', { text: r.title || 'Rezept' })]));
  const meta = [];
  if (r.servings) meta.push(`🍽️ ${r.servings} Port.`);
  if (r.minutes) meta.push(`⏱️ ${r.minutes} Min.`);
  if (meta.length) card.append(el('div', { class: 'recipe-meta', text: meta.join('  ·  ') }));
  if (r.ingredients?.length) {
    card.append(el('div', { class: 'recipe-sub', text: 'Zutaten' }));
    card.append(el('ul', { class: 'recipe-list' }, r.ingredients.map((i) => el('li', { text: i }))));
  }
  if (r.steps?.length) {
    card.append(el('div', { class: 'recipe-sub', text: 'Zubereitung' }));
    card.append(el('ol', { class: 'recipe-list' }, r.steps.map((sstep) => el('li', { text: sstep }))));
  }
  return card;
}

export function newRecipeModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Name des Gerichts', maxlength: '140' });
  const servings = el('input', { class: 'input', type: 'number', min: '0', placeholder: 'Portionen' });
  const minutes = el('input', { class: 'input', type: 'number', min: '0', placeholder: 'Minuten' });
  const ing = el('textarea', { class: 'input', rows: '4', placeholder: 'Zutaten — eine pro Zeile' });
  const steps = el('textarea', { class: 'input', rows: '4', placeholder: 'Schritte — einer pro Zeile' });
  const m = modal({
    title: 'Rezept teilen',
    body: (b) => b.append(field('Gericht', title), field('Portionen', servings), field('Dauer (Min.)', minutes), field('Zutaten', ing), field('Zubereitung', steps)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      const lines = (t) => t.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!title.value.trim()) return;
      try {
        await api.post(`/chats/${chatId}/recipe`, {
          title: title.value.trim(), servings: Number(servings.value) || 0, minutes: Number(minutes.value) || 0,
          ingredients: lines(ing), steps: lines(steps),
        });
        m.close();
      } catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Teilen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Flashcards
// ════════════════════════════════════════════════════════════════════════
export function renderFlashcards(m) {
  const d = m.flashcards || { cards: [] };
  const card = el('div', { class: 'uni-card deck-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('copy', 'sm'), el('span', { text: d.title || 'Lernkarten' }),
    el('span', { class: 'uni-badge', text: (d.cards?.length || 0) + ' Karten' })]));
  if (!d.cards?.length) return card;
  let i = 0; let flipped = false;
  const face = el('button', { class: 'flashcard', onClick: () => { flipped = !flipped; paint(); } });
  const counter = el('div', { class: 'deck-counter' });
  function paint() {
    const c = d.cards[i];
    clear(face).append(el('span', { class: 'flashcard-text', text: flipped ? c.back : c.front }));
    face.classList.toggle('flipped', flipped);
    counter.textContent = `${i + 1} / ${d.cards.length}`;
  }
  const nav = el('div', { class: 'deck-nav' }, [
    el('button', { class: 'btn small', onClick: () => { i = (i - 1 + d.cards.length) % d.cards.length; flipped = false; paint(); } }, '‹'),
    counter,
    el('button', { class: 'btn small', onClick: () => { i = (i + 1) % d.cards.length; flipped = false; paint(); } }, '›'),
  ]);
  card.append(face, nav);
  paint();
  return card;
}

export function newFlashcardsModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Deck-Name', maxlength: '140' });
  const cards = el('textarea', { class: 'input', rows: '6', placeholder: 'Vorderseite | Rückseite — eine Karte pro Zeile' });
  const m = modal({
    title: 'Lernkarten erstellen',
    body: (b) => b.append(field('Name', title), field('Karten (Front | Back)', cards)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      const parsed = cards.value.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2)
        .map((p) => ({ front: p[0].trim(), back: p.slice(1).join('|').trim() })).filter((c) => c.front && c.back);
      if (!title.value.trim() || !parsed.length) { toast('Mindestens eine Karte „Front | Back".', 'err'); return; }
      try { await api.post(`/chats/${chatId}/flashcards`, { title: title.value.trim(), cards: parsed }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Form / survey
// ════════════════════════════════════════════════════════════════════════
export function renderForm(m) {
  const f = m.form || { questions: [], results: [] };
  const card = el('div', { class: 'uni-card form-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('poll', 'sm'), el('span', { text: f.title || 'Formular' }),
    el('span', { class: 'uni-badge', text: (f.responseCount || 0) + ' Antworten' })]));
  const answered = f.myAnswers != null;
  const inputs = [];
  (f.questions || []).forEach((q, qi) => {
    const wrap = el('div', { class: 'form-q' }, [el('div', { class: 'form-qlabel', text: q.q })]);
    if (answered || f.closed) {
      // Show aggregated result.
      const res = f.results?.[qi] || {};
      if (q.type === 'choice') {
        for (const opt of q.options || []) wrap.append(el('div', { class: 'form-res', text: `${opt}: ${res.tally?.[opt] || 0}` }));
      } else if (q.type === 'rating') {
        wrap.append(el('div', { class: 'form-res', text: `Ø ${res.avg ?? 0} (${res.n || 0})` }));
      } else {
        for (const sample of (res.samples || []).slice(0, 5)) wrap.append(el('div', { class: 'form-res', text: '„' + sample + '"' }));
      }
      inputs.push(null);
    } else {
      let inp;
      if (q.type === 'choice') {
        inp = el('select', { class: 'input' }, [el('option', { value: '' }, '— wählen —'), ...(q.options || []).map((o) => el('option', { value: o }, o))]);
      } else if (q.type === 'rating') {
        inp = el('input', { class: 'input', type: 'number', min: '1', max: '5', placeholder: '1–5' });
      } else {
        inp = el('input', { class: 'input', placeholder: 'Antwort' });
      }
      wrap.append(inp);
      inputs.push(inp);
    }
    card.append(wrap);
  });
  if (!answered && !f.closed) {
    card.append(el('button', { class: 'btn primary small', onClick: async () => {
      const answers = (f.questions || []).map((q, qi) => {
        const inp = inputs[qi]; if (!inp) return null;
        return q.type === 'rating' ? (Number(inp.value) || null) : (inp.value || null);
      });
      try { await api.post(`/chats/${activeChat(m)}/messages/${m.id}/form/respond`, { answers }); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Absenden'));
  } else if (f.closed) {
    card.append(el('div', { class: 'form-closed', text: 'Geschlossen' }));
  }
  return card;
}

export function newFormModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel', maxlength: '140' });
  const qWrap = el('div', { class: 'form-builder' });
  const rows = [];
  function addRow() {
    const q = el('input', { class: 'input', placeholder: 'Frage' });
    const type = el('select', { class: 'input' }, [el('option', { value: 'text' }, 'Freitext'), el('option', { value: 'choice' }, 'Auswahl'), el('option', { value: 'rating' }, 'Bewertung 1–5')]);
    const opts = el('input', { class: 'input', placeholder: 'Optionen, mit Komma' });
    opts.style.display = 'none';
    type.addEventListener('change', () => { opts.style.display = type.value === 'choice' ? '' : 'none'; });
    const row = el('div', { class: 'form-builder-row' }, [q, type, opts]);
    qWrap.append(row); rows.push({ q, type, opts });
  }
  addRow();
  const m = modal({
    title: 'Formular erstellen',
    body: (b) => b.append(field('Titel', title), qWrap, el('button', { class: 'btn small', onClick: addRow }, '+ Frage')),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      const questions = rows.map((r) => {
        const o = { q: r.q.value.trim(), type: r.type.value };
        if (r.type.value === 'choice') o.options = r.opts.value.split(',').map((x) => x.trim()).filter(Boolean);
        return o;
      }).filter((q) => q.q && (q.type !== 'choice' || (q.options && q.options.length >= 2)));
      if (!title.value.trim() || !questions.length) { toast('Titel + mindestens eine gültige Frage.', 'err'); return; }
      try { await api.post(`/chats/${chatId}/form`, { title: title.value.trim(), questions }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Bookmark / link collection
// ════════════════════════════════════════════════════════════════════════
export function renderBookmark(m) {
  const bm = m.bookmark || { links: [] };
  const card = el('div', { class: 'uni-card bookmark-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('bookmark', 'sm'), el('span', { text: bm.title || 'Lesezeichen' })]));
  const list = el('ul', { class: 'bm-list' });
  for (const l of bm.links || []) {
    list.append(el('li', {}, [
      el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.title || l.url }),
      l.note ? el('div', { class: 'bm-note', text: l.note }) : null,
    ].filter(Boolean)));
  }
  card.append(list);
  card.append(el('div', { class: 'uni-actions' }, [el('button', { class: 'btn small', onClick: () => addLinkModal(m) }, '+ Link')]));
  return card;
}

function addLinkModal(m) {
  const url = el('input', { class: 'input', placeholder: 'https://…' });
  const title = el('input', { class: 'input', placeholder: 'Titel (optional)' });
  const note = el('input', { class: 'input', placeholder: 'Notiz (optional)' });
  const md = modal({
    title: 'Link hinzufügen',
    body: (b) => b.append(field('URL', url), field('Titel', title), field('Notiz', note)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!url.value.trim()) return;
      try { await api.post(`/chats/${activeChat(m)}/messages/${m.id}/bookmark/links`, { url: url.value.trim(), title: title.value.trim(), note: note.value.trim() }); md.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Hinzufügen')],
  });
}

export function newBookmarkModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel der Sammlung', maxlength: '140' });
  const first = el('input', { class: 'input', placeholder: 'Erster Link (optional)' });
  const m = modal({
    title: 'Lesezeichen-Sammlung',
    body: (b) => b.append(field('Titel', title), field('Erster Link', first)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!title.value.trim()) return;
      const links = first.value.trim() ? [{ url: first.value.trim() }] : [];
      try { await api.post(`/chats/${chatId}/bookmark`, { title: title.value.trim(), links }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Pinned places
// ════════════════════════════════════════════════════════════════════════
export function renderPlace(m) {
  const pl = m.place || { pins: [] };
  const card = el('div', { class: 'uni-card place-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('pin', 'sm'), el('span', { text: pl.title || 'Orte' }),
    el('span', { class: 'uni-badge', text: (pl.pins?.length || 0) + ' Orte' })]));
  const list = el('ul', { class: 'place-list' });
  for (const p of pl.pins || []) {
    list.append(el('li', {}, [
      el('a', { href: `https://maps.google.com/?q=${p.lat},${p.lng}`, target: '_blank', rel: 'noopener', text: '📍 ' + p.name }),
      p.note ? el('span', { class: 'place-note', text: ' — ' + p.note }) : null,
    ].filter(Boolean)));
  }
  card.append(list);
  card.append(el('div', { class: 'uni-actions' }, [el('button', { class: 'btn small', onClick: () => addPinModal(m) }, '+ Ort')]));
  return card;
}

function addPinModal(m) {
  const name = el('input', { class: 'input', placeholder: 'Name des Orts' });
  const err = el('div', { class: 'formerr' });
  const useGps = el('button', { class: 'btn small', onClick: () => {
    if (!navigator.geolocation) { err.textContent = 'GPS nicht verfügbar.'; return; }
    navigator.geolocation.getCurrentPosition((pos) => { coords = [pos.coords.latitude, pos.coords.longitude]; err.textContent = `📍 ${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`; },
      () => { err.textContent = 'Standort nicht verfügbar.'; });
  } }, 'Aktuellen Standort verwenden');
  let coords = null;
  const lat = el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Breitengrad' });
  const lng = el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Längengrad' });
  const md = modal({
    title: 'Ort hinzufügen',
    body: (b) => b.append(field('Name', name), useGps, field('Lat', lat), field('Lng', lng), err),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      const la = coords ? coords[0] : Number(lat.value); const ln = coords ? coords[1] : Number(lng.value);
      if (!name.value.trim() || Number.isNaN(la) || Number.isNaN(ln)) { err.textContent = 'Name + Koordinaten nötig.'; return; }
      try { await api.post(`/chats/${activeChat(m)}/messages/${m.id}/place/pins`, { name: name.value.trim(), lat: la, lng: ln }); md.close(); }
      catch (e) { err.textContent = e.message || 'Fehler'; }
    } }, 'Hinzufügen')],
  });
}

export function newPlaceModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel', maxlength: '140' });
  const name = el('input', { class: 'input', placeholder: 'Erster Ort' });
  const err = el('div', { class: 'formerr' });
  let coords = null;
  const gps = el('button', { class: 'btn small', onClick: () => {
    if (!navigator.geolocation) { err.textContent = 'GPS nicht verfügbar.'; return; }
    navigator.geolocation.getCurrentPosition((pos) => { coords = [pos.coords.latitude, pos.coords.longitude]; err.textContent = `📍 erfasst`; }, () => { err.textContent = 'Standort nicht verfügbar.'; });
  } }, 'Aktuellen Standort als ersten Ort');
  const m = modal({
    title: 'Orte-Sammlung',
    body: (b) => b.append(field('Titel', title), field('Erster Ort', name), gps, err),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!title.value.trim() || !name.value.trim() || !coords) { err.textContent = 'Titel, Ortsname und Standort nötig.'; return; }
      try { await api.post(`/chats/${chatId}/place`, { title: title.value.trim(), pins: [{ name: name.value.trim(), lat: coords[0], lng: coords[1] }] }); m.close(); }
      catch (e) { err.textContent = e.message || 'Fehler'; }
    } }, 'Erstellen')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Video note (round) — renders the video attachment in a circular frame
// ════════════════════════════════════════════════════════════════════════
export function renderVideoNote(m) {
  const wrap = el('div', { class: 'videonote' });
  const att = m.attachment;
  if (att && att.url) {
    const v = el('video', { src: att.url.startsWith('http') ? att.url : '/api/' + att.url.replace(/^\//, ''), class: 'videonote-vid', loop: true, muted: true, playsinline: true, controls: false });
    v.addEventListener('click', () => { v.muted = !v.muted; v.paused ? v.play() : null; });
    wrap.append(v);
  } else {
    wrap.append(el('div', { class: 'videonote-ph', text: '⭕' }));
  }
  return wrap;
}

// ════════════════════════════════════════════════════════════════════════
// Watch party
// ════════════════════════════════════════════════════════════════════════
export function renderWatchParty(m) {
  const wp = m.watchparty || {};
  const card = el('div', { class: 'uni-card watch-card' });
  card.append(el('div', { class: 'uni-head' }, [icon('film', 'sm'), el('span', { text: wp.title || 'Kinoabend' })]));
  card.append(el('a', { class: 'watch-link', href: wp.url, target: '_blank', rel: 'noopener', text: '▶ ' + (wp.url || '') }));
  card.append(el('div', { class: 'watch-state', text: wp.playing ? 'läuft' : 'pausiert' }));
  card.append(el('div', { class: 'uni-actions' }, [
    el('button', { class: 'btn small', onClick: () => syncWatch(m, { positionMs: Math.round((wp.positionMs || 0)), playing: !wp.playing }) }, wp.playing ? 'Pause für alle' : 'Start für alle'),
  ]));
  return card;
}

async function syncWatch(m, state) {
  try { await api.post(`/chats/${activeChat(m)}/messages/${m.id}/watchparty/sync`, state); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

export function newWatchPartyModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel (optional)' });
  const url = el('input', { class: 'input', placeholder: 'Video-Link (YouTube, …)' });
  const m = modal({
    title: 'Kinoabend starten',
    body: (b) => b.append(field('Titel', title), field('Video-Link', url)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      if (!url.value.trim()) return;
      try { await api.post(`/chats/${chatId}/watchparty`, { title: title.value.trim(), url: url.value.trim() }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Starten')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Virtual gift
// ════════════════════════════════════════════════════════════════════════
const GIFTS = { cake: '🎂', heart: '❤️', trophy: '🏆', flower: '🌸', star: '⭐', gift: '🎁', balloon: '🎈', rocket: '🚀' };

export function renderGift(m) {
  const g = m.gift || {};
  const card = el('div', { class: 'uni-card gift-card' });
  card.append(el('div', { class: 'gift-emoji', text: GIFTS[g.kind] || '🎁' }));
  if (g.note) card.append(el('div', { class: 'gift-note', text: g.note }));
  return card;
}

export function sendGiftModal(chatId) {
  const note = el('input', { class: 'input', placeholder: 'Nachricht (optional)', maxlength: '280' });
  let chosen = 'gift';
  const grid = el('div', { class: 'gift-grid' });
  Object.entries(GIFTS).forEach(([kind, emoji]) => {
    const btn = el('button', { class: 'gift-pick', onClick: () => { chosen = kind; [...grid.children].forEach((c) => c.classList.remove('on')); btn.classList.add('on'); }, text: emoji });
    if (kind === chosen) btn.classList.add('on');
    grid.append(btn);
  });
  const m = modal({
    title: 'Geschenk senden',
    body: (b) => b.append(grid, field('Nachricht', note)),
    foot: [el('button', { class: 'btn primary', onClick: async () => {
      try { await api.post(`/chats/${chatId}/gift`, { kind: chosen, note: note.value.trim() }); m.close(); }
      catch (e) { toast(e.message || 'Fehler', 'err'); }
    } }, 'Senden')],
  });
}

// ════════════════════════════════════════════════════════════════════════
// Attach-menu entries (spread into chat.js attachMenu)
// ════════════════════════════════════════════════════════════════════════
export function universumAttachEntries(chatId, flag) {
  return [
    flag('whiteboard') ? { label: 'Whiteboard', icon: 'paint', onClick: () => newWhiteboardModal(chatId) } : null,
    flag('collabDocs') ? { label: 'Dokument', icon: 'file', onClick: () => newDocModal(chatId) } : null,
    flag('playlists') ? { label: 'Playlist', icon: 'music', onClick: () => newPlaylistModal(chatId) } : null,
    flag('recipes') ? { label: 'Rezept', icon: 'file', onClick: () => newRecipeModal(chatId) } : null,
    flag('flashcards') ? { label: 'Lernkarten', icon: 'file', onClick: () => newFlashcardsModal(chatId) } : null,
    flag('forms') ? { label: 'Formular', icon: 'poll', onClick: () => newFormModal(chatId) } : null,
    flag('bookmarks') ? { label: 'Lesezeichen', icon: 'star', onClick: () => newBookmarkModal(chatId) } : null,
    flag('places') ? { label: 'Orte', icon: 'pin', onClick: () => newPlaceModal(chatId) } : null,
    flag('watchParty') ? { label: 'Kinoabend', icon: 'video', onClick: () => newWatchPartyModal(chatId) } : null,
    flag('virtualGifts') ? { label: 'Geschenk', icon: 'gift', onClick: () => sendGiftModal(chatId) } : null,
  ].filter(Boolean);
}
