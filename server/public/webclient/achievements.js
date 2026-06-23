/* achievements.js — 0.38.0 "Universum" Pillar E: the "Erfolge" pane. Shows the
   badges the user has unlocked plus the locked ones from the catalogue, and is
   nudged live by the 'achievement' socket event (the toast is fired in app.js). */

import { api } from './api.js';
import { el, clear, icon } from './ui.js';

export async function renderAchievementsPane(head, body) {
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Erfolge' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Aktualisieren', 'aria-label': 'Aktualisieren', onClick: () => paint(body) }, icon('refresh')),
    ]),
  );
  paint(body);
}

async function paint(body) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.append(scroll);
  let data;
  try { data = await api.get('/me/achievements'); }
  catch { scroll.append(el('div', { class: 'pane-empty', text: 'Konnte Erfolge nicht laden.' })); return; }
  const earned = new Map((data.achievements || []).map((a) => [a.kind, a]));
  const catalogue = data.catalogue || {};
  const grid = el('div', { class: 'ach-grid' });
  scroll.append(el('div', { class: 'ach-count', text: `${earned.size} / ${Object.keys(catalogue).length} freigeschaltet` }), grid);
  for (const [kind, meta] of Object.entries(catalogue)) {
    const got = earned.has(kind);
    grid.append(el('div', { class: `ach-badge ${got ? 'on' : 'off'}` }, [
      el('div', { class: 'ach-emoji', text: got ? meta.emoji : '🔒' }),
      el('div', { class: 'ach-title', text: meta.title }),
      el('div', { class: 'ach-desc', text: meta.desc || '' }),
    ]));
  }
}
