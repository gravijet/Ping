/* store.js — single source of truth for the messenger. Holds the signed-in
   user, the chat list, message history caches, presence and typing state, and a
   tiny pub/sub so views re-render on change. */

const subs = new Map(); // event -> Set<fn>

export const state = {
  me: null,             // privateUser
  config: null,         // GET /api/config
  chats: new Map(),     // chatId -> chatView
  messages: new Map(),  // chatId -> [messageView] (ascending by createdAt)
  loadedAll: new Set(), // chatIds whose full history is loaded
  activeId: null,
  online: new Set(),    // userIds currently online
  lastSeen: new Map(),  // userId -> ts
  typing: new Map(),    // chatId -> Map<userId, timeoutHandle>
  search: '',
  chatFilter: 'all',    // 'all' | 'unread' | 'fav' | 'groups'
};

export function on(event, fn) {
  if (!subs.has(event)) subs.set(event, new Set());
  subs.get(event).add(fn);
  return () => subs.get(event)?.delete(fn);
}
export function emit(event, data) {
  const set = subs.get(event);
  if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(e); } }
}

// ---- chats ----------------------------------------------------------------
export function setChats(list) {
  state.chats = new Map(list.map((c) => [c.id, c]));
  emit('chats');
}
export function upsertChat(chat) {
  state.chats.set(chat.id, chat);
  emit('chats');
  emit('chat:' + chat.id, chat);
}
export function getChat(id) { return state.chats.get(id); }
export function chatsSorted() {
  return [...state.chats.values()].sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}

// ---- messages -------------------------------------------------------------
export function setHistory(chatId, msgs, { all = false } = {}) {
  const asc = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
  state.messages.set(chatId, asc);
  if (all) state.loadedAll.add(chatId);
  emit('messages:' + chatId);
}
export function prependHistory(chatId, older, { all = false } = {}) {
  const cur = state.messages.get(chatId) || [];
  const asc = [...older].sort((a, b) => a.createdAt - b.createdAt);
  state.messages.set(chatId, [...asc, ...cur]);
  if (all) state.loadedAll.add(chatId);
  emit('messages:' + chatId);
}
export function getHistory(chatId) { return state.messages.get(chatId) || []; }

export function addMessage(chatId, msg) {
  const cur = state.messages.get(chatId) || [];
  const i = cur.findIndex((m) => m.id === msg.id);
  if (i >= 0) cur[i] = msg; else cur.push(msg);
  state.messages.set(chatId, cur);
  emit('messages:' + chatId);
}
export function replaceMessage(chatId, msg) {
  const cur = state.messages.get(chatId) || [];
  const i = cur.findIndex((m) => m.id === msg.id);
  if (i >= 0) { cur[i] = msg; emit('messages:' + chatId); }
}
export function removeMessage(chatId, msgId) {
  const cur = state.messages.get(chatId) || [];
  state.messages.set(chatId, cur.filter((m) => m.id !== msgId));
  emit('messages:' + chatId);
}
export function updateReceiptStatus(chatId, msgId, status) {
  const cur = state.messages.get(chatId) || [];
  const m = cur.find((x) => x.id === msgId);
  if (m) { m.status = status; emit('messages:' + chatId); }
}

// ---- presence -------------------------------------------------------------
export function setOnline(ids) { state.online = new Set(ids); emit('presence'); }
export function setPresence(userId, online, lastSeen) {
  if (online) state.online.add(userId); else state.online.delete(userId);
  if (lastSeen) state.lastSeen.set(userId, lastSeen);
  emit('presence', userId);
}
export function isOnline(userId) { return state.online.has(userId); }

// ---- typing ---------------------------------------------------------------
export function setTyping(chatId, userId, isTyping) {
  if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
  const m = state.typing.get(chatId);
  if (m.has(userId)) clearTimeout(m.get(userId));
  if (isTyping) {
    m.set(userId, setTimeout(() => {
      m.delete(userId); emit('typing:' + chatId); emit('typing');
    }, 6500));
  } else m.delete(userId);
  emit('typing:' + chatId);
  emit('typing');
}
export function typingUsers(chatId) {
  return [...(state.typing.get(chatId)?.keys() || [])];
}
