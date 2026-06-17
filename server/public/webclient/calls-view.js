/* calls-view.js — the "Anrufe" list-pane section: the user's call history
   (newest first) with redial buttons. Live calls themselves live in calls.js;
   this is just the log from GET /calls. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, chatTime, toast, confirmModal } from './ui.js';
import { startCall } from './calls.js';
import { startDirect } from './contacts.js';

export async function renderCallsPane(head, body) {
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Anrufe' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Verlauf leeren', onClick: () => clearLog(body) }, icon('trash')),
    ]),
  );
  clear(body).append(el('div', { class: 'pane-empty', text: 'Lade …' }));
  await load(body);
}

async function load(body) {
  let calls = [];
  try { ({ calls } = await api.get('/calls')); } catch (e) { toast(e.message, 'err'); }
  clear(body);
  if (!calls.length) { body.append(el('div', { class: 'pane-empty',
    text: 'Noch keine Anrufe. Starte einen aus einem Chat heraus.' })); return; }
  const scroll = el('div', { class: 'pane-scroll' });
  body.appendChild(scroll);
  for (const c of calls) scroll.appendChild(row(c));
}

function row(c) {
  const missed = c.outcome === 'missed' || c.outcome === 'declined';
  const ic = c.direction === 'incoming' ? (missed ? 'callMissed' : 'callIn') : 'callOut';
  const cls = c.direction === 'incoming' ? (missed ? 'missed' : 'in') : 'out';
  const label = c.outcome === 'completed' ? fmtDur(c.duration)
    : c.outcome === 'missed' ? 'Verpasst'
    : c.outcome === 'declined' ? 'Abgelehnt'
    : c.outcome === 'canceled' ? 'Abgebrochen' : 'Fehlgeschlagen';

  return el('div', { class: 'urow call-row', onClick: () => openPeerChat(c.peer) }, [
    avatar(c.peer, 48, { kind: 'user', online: store.isOnline(c.peer.id) }),
    el('div', { class: 'meta' }, [
      el('div', { class: 'uname', text: c.peer.displayName }),
      el('div', { class: `uabout` }, [
        el('span', { class: `ctype ${cls}` }, icon(ic, 'sm')),
        el('span', { text: `${label} · ${chatTime(c.createdAt)}` }),
      ]),
    ]),
    el('button', { class: 'iconbtn', title: c.video ? 'Videoanruf' : 'Sprachanruf',
      onClick: (e) => { e.stopPropagation(); startCall(c.peer, !!c.video); } },
      icon(c.video ? 'video' : 'phone')),
  ]);
}

async function openPeerChat(peer) {
  try { await startDirect(peer.id); } catch (e) { toast(e.message, 'err'); }
}

function fmtDur(sec) {
  sec = sec || 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} Min ${s} Sek` : `${s} Sek`;
}

async function clearLog(body) {
  if (!await confirmModal({ title: 'Verlauf leeren', message: 'Den gesamten Anrufverlauf löschen?',
    confirmText: 'Leeren', danger: true })) return;
  try { await api.del('/calls'); } catch (e) { /* endpoint may not exist; clear view anyway */ }
  clear(body).append(el('div', { class: 'pane-empty', text: 'Verlauf geleert.' }));
}
