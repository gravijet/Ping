import { db, now } from './db.js';
import { uid } from './repo.js';

// In-chat mini-games (0.34.0). A game is backed by a normal message (type='game')
// whose live state lives here and rides along in messageView.game. Moves come in
// over HTTP, the server validates the turn, updates the state, and broadcasts the
// usual message-updated event so both players' boards stay in sync. Two games
// ship: tic-tac-toe (3×3) and connect-4 (7×6).

const KINDS = {
  tictactoe: { cells: 9, line: ticTacToeWinner },
  connect4: { cells: 42, line: connect4Winner },
};

const s = {
  insert: db.prepare(`
    INSERT INTO games (id, message_id, chat_id, kind, state, turn, winner, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`),
  byMessage: db.prepare('SELECT * FROM games WHERE message_id = ?'),
  update: db.prepare(
    'UPDATE games SET state = ?, turn = ?, winner = ?, updated_at = ? WHERE message_id = ?'
  ),
};

/** Start a game backed by a 'game' message. starter takes the first turn. */
export function createGame({ messageId, chatId, kind, starterId }) {
  if (!KINDS[kind]) return null;
  const id = uid();
  const cells = new Array(KINDS[kind].cells).fill(null);
  const state = JSON.stringify({ cells, players: [starterId], mark: { [starterId]: 0 } });
  s.insert.run(id, messageId, chatId, kind, state, starterId, now(), now());
  return s.byMessage.get(messageId);
}

/**
 * Apply a move. `cell` is the target index (tic-tac-toe) or column (connect-4).
 * Late joiners are auto-assigned the second seat on their first move. Returns
 * { ok:true } or { ok:false, error }.
 */
export function applyMove(messageId, userId, cell) {
  const row = s.byMessage.get(messageId);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.winner) return { ok: false, error: 'over' };
  const meta = KINDS[row.kind];
  const st = JSON.parse(row.state);
  // Turn enforcement: when the opponent is known, only the player whose turn it
  // is may move. Before the second player has joined, `turn` is open — but the
  // last mover still can't go twice in a row (you'd be playing against yourself).
  if (row.turn) {
    if (row.turn !== userId) return { ok: false, error: 'not_your_turn' };
  } else if (st.last && st.last === userId) {
    return { ok: false, error: 'not_your_turn' };
  }
  // Seat assignment: starter is seat 0; the first other player becomes seat 1.
  if (!(userId in st.mark)) {
    if (st.players.length >= 2) return { ok: false, error: 'full' };
    st.players.push(userId);
    st.mark[userId] = 1;
  }
  const seat = st.mark[userId];
  const idx = row.kind === 'connect4' ? dropColumn(st.cells, cell) : cell;
  if (idx == null || idx < 0 || idx >= st.cells.length || st.cells[idx] != null) {
    return { ok: false, error: 'bad_move' };
  }
  st.cells[idx] = seat;
  st.last = userId;
  const win = meta.line(st.cells);
  let winner = null;
  if (win != null) winner = st.players[win] || null;
  else if (st.cells.every((c) => c != null)) winner = 'draw';
  // Next turn = the other seated player (if known), else open until they join.
  const other = st.players.find((p) => p !== userId) || null;
  const turn = winner ? null : other;
  s.update.run(JSON.stringify(st), turn, winner, now(), messageId);
  return { ok: true };
}

export function gameView(messageId) {
  const row = s.byMessage.get(messageId);
  if (!row) return null;
  const st = JSON.parse(row.state);
  return {
    kind: row.kind,
    cells: st.cells,
    players: st.players,
    turn: row.turn || null,
    winner: row.winner || null,
  };
}

// ---- winners --------------------------------------------------------------

function ticTacToeWinner(c) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, b, d] of lines) {
    if (c[a] != null && c[a] === c[b] && c[a] === c[d]) return c[a];
  }
  return null;
}

// connect-4 board is 7 cols × 6 rows, row-major (idx = row*7 + col).
function dropColumn(cells, col) {
  if (col < 0 || col > 6) return null;
  for (let row = 5; row >= 0; row--) {
    const i = row * 7 + col;
    if (cells[i] == null) return i;
  }
  return null;
}
function connect4Winner(c) {
  const at = (r, col) => (r < 0 || r > 5 || col < 0 || col > 6 ? null : c[r * 7 + col]);
  for (let r = 0; r < 6; r++) {
    for (let col = 0; col < 7; col++) {
      const v = at(r, col);
      if (v == null) continue;
      for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
        if (at(r+dr,col+dc)===v && at(r+2*dr,col+2*dc)===v && at(r+3*dr,col+3*dc)===v) return v;
      }
    }
  }
  return null;
}

export const GAME_KINDS = Object.keys(KINDS);
