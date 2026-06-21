/* games.js — In-Chat Mini-Games (0.34.0). A 'game' message carries live state in
   message.game ({ kind, cells, players, turn, winner }). Tic-Tac-Toe (3×3) and
   Vier-gewinnt / Connect-4 (7×6). Tapping a cell POSTs a move; the server
   validates turns + win/draw and re-broadcasts message-updated. */

import { api } from './api.js';
import * as store from './store.js';
import { el, icon, modal, toast } from './ui.js';

const MARKS = ['🔵', '🔴']; // player 0 / player 1

/** Render the in-chat game board for message [m]. */
export function renderGame(m) {
  const g = m.game || {};
  const meId = store.state.me?.id;
  const wrap = el('div', { class: `game-card ${g.kind || ''}` });
  wrap.append(el('div', { class: 'game-head' }, [
    icon('poll', 'sm'),
    el('div', { class: 'game-title', text: g.kind === 'connect4' ? 'Vier gewinnt' : 'Tic-Tac-Toe' }),
    el('div', { class: 'game-status', text: statusText(g, meId) }),
  ]));
  const myIdx = (g.players || []).indexOf(meId);
  const myTurn = !g.winner && g.turn === meId;
  // Anyone not yet a player can join by making the first/next move (server adds
  // them); a seated player moves on their turn.
  const canMove = !g.winner && (myTurn || myIdx === -1) && (g.players || []).length < 2 || myTurn;

  if (g.kind === 'connect4') {
    const grid = el('div', { class: 'c4-grid' });
    for (let col = 0; col < 7; col++) {
      const colEl = el('div', { class: 'c4-col', onClick: () => canMove && move(m, col) });
      for (let row = 0; row < 6; row++) {
        const v = (g.cells || [])[row * 7 + col];
        colEl.append(el('div', { class: 'c4-cell' }, v == null ? '' : MARKS[v]));
      }
      grid.append(colEl);
    }
    wrap.append(grid);
  } else {
    const grid = el('div', { class: 'ttt-grid' });
    for (let i = 0; i < 9; i++) {
      const v = (g.cells || [])[i];
      grid.append(el('button', { class: 'ttt-cell', disabled: v != null || !canMove ? 'disabled' : null,
        onClick: () => canMove && v == null && move(m, i) }, v == null ? '' : MARKS[v]));
    }
    wrap.append(grid);
  }
  return wrap;
}

function statusText(g, meId) {
  if (g.winner) {
    const idx = (g.players || []).indexOf(g.winner);
    if (g.winner === 'draw') return 'Unentschieden';
    return g.winner === meId ? 'Du hast gewonnen! 🎉' : `${MARKS[idx] || ''} hat gewonnen`;
  }
  if (!g.turn) return 'Tippe, um zu spielen';
  return g.turn === meId ? 'Du bist am Zug' : 'Gegner am Zug …';
}

async function move(m, cell) {
  try {
    const { message } = await api.post(`/chats/${m.chatId}/messages/${m.id}/game/move`, { cell });
    store.replaceMessage(m.chatId, message);
  } catch (e) { toast(e.message || 'Zug nicht möglich.', 'err'); }
}

/** Pick a game type, then create it in [chatId]. */
export function newGameModal(chatId) {
  const dlg = modal({
    title: 'Spiel starten',
    body: (b) => b.append(
      el('p', { class: 'hint', text: 'Wähle ein Spiel — dein Gegner tritt durch den ersten Zug bei.' }),
      el('div', { class: 'game-pick' }, [
        el('button', { class: 'btn', onClick: () => start('tictactoe') }, '⭕ Tic-Tac-Toe'),
        el('button', { class: 'btn', onClick: () => start('connect4') }, '🔴 Vier gewinnt'),
      ]),
    ),
  });
  async function start(kind) {
    try {
      const { message } = await api.post(`/chats/${chatId}/games`, { kind });
      store.addMessage(chatId, message);
      dlg.close();
    } catch (e) { toast(e.message || 'Konnte das Spiel nicht starten.', 'err'); }
  }
}
