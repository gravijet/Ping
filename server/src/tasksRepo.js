import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for collaborative task lists ("Aufgaben"). Like polls and events, a
// task list is backed by a normal message (type='tasklist'); the items live in
// tasklist_items and ride along in messageView.tasklist. Anyone in the chat can
// tick an item or append a new one, and everyone sees the change live via the
// usual message-updated event.

const MAX_ITEMS = 50;

const s = {
  insertList: db.prepare(`
    INSERT INTO tasklists (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  listById: db.prepare('SELECT * FROM tasklists WHERE id = ?'),
  listByMessage: db.prepare('SELECT * FROM tasklists WHERE message_id = ?'),
  insertItem: db.prepare(`
    INSERT INTO tasklist_items (id, tasklist_id, text, sort, created_at)
    VALUES (?, ?, ?, ?, ?)`),
  items: db.prepare(`
    SELECT i.*, u.display_name AS doneByName
      FROM tasklist_items i
      LEFT JOIN users u ON u.id = i.done_by
     WHERE i.tasklist_id = ?
     ORDER BY i.sort, i.created_at`),
  itemById: db.prepare('SELECT * FROM tasklist_items WHERE id = ?'),
  itemCount: db.prepare('SELECT COUNT(*) AS n FROM tasklist_items WHERE tasklist_id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM tasklist_items WHERE tasklist_id = ?'),
  setDone: db.prepare(
    'UPDATE tasklist_items SET done = ?, done_by = ?, done_at = ? WHERE id = ?'
  ),
};

/** Create the task list + its initial items backing a 'tasklist' message. */
export function createTaskList({ messageId, chatId, creatorId, title, items = [] }) {
  const id = uid();
  const ts = now();
  s.insertList.run(id, messageId, chatId, creatorId, title, ts);
  items.slice(0, MAX_ITEMS).forEach((text, i) => {
    s.insertItem.run(uid(), id, text, i, ts);
  });
  return s.listById.get(id);
}

export const getTaskListByMessage = (messageId) => s.listByMessage.get(messageId);

/** Append an item to a task list. Returns false past the per-list cap. */
export function addTaskItem(messageId, text) {
  const list = s.listByMessage.get(messageId);
  if (!list) return false;
  if (s.itemCount.get(list.id).n >= MAX_ITEMS) return false;
  const sort = s.maxSort.get(list.id).m + 1;
  s.insertItem.run(uid(), list.id, text, sort, now());
  return true;
}

/** Toggle (or set) an item's done flag, recording who completed it. */
export function setTaskItemDone(messageId, itemId, userId, done) {
  const list = s.listByMessage.get(messageId);
  if (!list) return false;
  const item = s.itemById.get(itemId);
  if (!item || item.tasklist_id !== list.id) return false;
  s.setDone.run(done ? 1 : 0, done ? userId : null, done ? now() : null, itemId);
  return true;
}

/** The task list as the chat sees it: items with done state + progress. */
export function taskListView(messageId) {
  const list = s.listByMessage.get(messageId);
  if (!list) return null;
  const items = s.items.all(list.id).map((i) => ({
    id: i.id,
    text: i.text,
    done: !!i.done,
    doneBy: i.done_by || null,
    doneByName: i.done ? i.doneByName || '' : '',
    doneAt: i.done_at || null,
  }));
  return {
    id: list.id,
    title: list.title,
    creatorId: list.creator_id,
    items,
    total: items.length,
    completed: items.filter((i) => i.done).length,
  };
}

export const TASKLIST_MAX_ITEMS = MAX_ITEMS;
