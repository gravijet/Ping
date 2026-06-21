import { db, now } from './db.js';
import { uid } from './repo.js';

// Kanban boards (0.34.0). Like tasklists, a board is backed by a normal message
// (type='board'); columns + cards live here and ride along in messageView.board.
// Anyone in the chat can add/move/delete cards and everyone sees it live via the
// usual message-updated event.

const MAX_COLUMNS = 8;
const MAX_CARDS = 200;

const s = {
  insertBoard: db.prepare(`
    INSERT INTO boards (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  boardById: db.prepare('SELECT * FROM boards WHERE id = ?'),
  boardByMessage: db.prepare('SELECT * FROM boards WHERE message_id = ?'),
  insertColumn: db.prepare(`
    INSERT INTO board_columns (id, board_id, title, sort, created_at)
    VALUES (?, ?, ?, ?, ?)`),
  columns: db.prepare('SELECT * FROM board_columns WHERE board_id = ? ORDER BY sort, created_at'),
  columnById: db.prepare('SELECT * FROM board_columns WHERE id = ?'),
  columnCount: db.prepare('SELECT COUNT(*) AS n FROM board_columns WHERE board_id = ?'),
  maxColSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM board_columns WHERE board_id = ?'),
  delColumn: db.prepare('DELETE FROM board_columns WHERE id = ?'),
  insertCard: db.prepare(`
    INSERT INTO board_cards (id, board_id, column_id, text, sort, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  cards: db.prepare('SELECT * FROM board_cards WHERE board_id = ? ORDER BY column_id, sort, created_at'),
  cardById: db.prepare('SELECT * FROM board_cards WHERE id = ?'),
  cardCount: db.prepare('SELECT COUNT(*) AS n FROM board_cards WHERE board_id = ?'),
  maxCardSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM board_cards WHERE column_id = ?'),
  moveCard: db.prepare('UPDATE board_cards SET column_id = ?, sort = ? WHERE id = ?'),
  editCard: db.prepare('UPDATE board_cards SET text = ? WHERE id = ?'),
  delCard: db.prepare('DELETE FROM board_cards WHERE id = ?'),
};

/** Create the board + its initial columns backing a 'board' message. */
export function createBoard({ messageId, chatId, creatorId, title, columns = ['Zu erledigen', 'In Arbeit', 'Fertig'] }) {
  const id = uid();
  const ts = now();
  s.insertBoard.run(id, messageId, chatId, creatorId, title, ts);
  columns.slice(0, MAX_COLUMNS).forEach((t, i) => s.insertColumn.run(uid(), id, t, i, ts));
  return s.boardById.get(id);
}

export const getBoardByMessage = (messageId) => s.boardByMessage.get(messageId);

export function addBoardColumn(messageId, title) {
  const board = s.boardByMessage.get(messageId);
  if (!board || s.columnCount.get(board.id).n >= MAX_COLUMNS) return false;
  s.insertColumn.run(uid(), board.id, title, s.maxColSort.get(board.id).m + 1, now());
  return true;
}

export function addBoardCard(messageId, columnId, text, userId) {
  const board = s.boardByMessage.get(messageId);
  if (!board || s.cardCount.get(board.id).n >= MAX_CARDS) return false;
  const col = s.columnById.get(columnId);
  if (!col || col.board_id !== board.id) return false;
  s.insertCard.run(uid(), board.id, columnId, text, s.maxCardSort.get(columnId).m + 1, userId, now());
  return true;
}

export function moveBoardCard(messageId, cardId, columnId, sort) {
  const board = s.boardByMessage.get(messageId);
  if (!board) return false;
  const card = s.cardById.get(cardId);
  const col = s.columnById.get(columnId);
  if (!card || card.board_id !== board.id || !col || col.board_id !== board.id) return false;
  s.moveCard.run(columnId, Number.isFinite(sort) ? sort : (s.maxCardSort.get(columnId).m + 1), cardId);
  return true;
}

export function editBoardCard(messageId, cardId, text) {
  const board = s.boardByMessage.get(messageId);
  const card = s.cardById.get(cardId);
  if (!board || !card || card.board_id !== board.id) return false;
  s.editCard.run(text, cardId);
  return true;
}

export function deleteBoardCard(messageId, cardId) {
  const board = s.boardByMessage.get(messageId);
  const card = s.cardById.get(cardId);
  if (!board || !card || card.board_id !== board.id) return false;
  s.delCard.run(cardId);
  return true;
}

/** The board as the chat sees it: columns each with their ordered cards. */
export function boardView(messageId) {
  const board = s.boardByMessage.get(messageId);
  if (!board) return null;
  const cards = s.cards.all(board.id);
  const byCol = new Map();
  for (const c of cards) {
    if (!byCol.has(c.column_id)) byCol.set(c.column_id, []);
    byCol.get(c.column_id).push({ id: c.id, text: c.text, createdBy: c.created_by || null });
  }
  return {
    id: board.id,
    title: board.title,
    creatorId: board.creator_id,
    columns: s.columns.all(board.id).map((col) => ({
      id: col.id,
      title: col.title,
      cards: byCol.get(col.id) || [],
    })),
    cardCount: cards.length,
  };
}

export const BOARD_MAX_COLUMNS = MAX_COLUMNS;
