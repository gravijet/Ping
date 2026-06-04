import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { config } from './config.js';
import { getUserById, publicUser, touchLastSeen } from './repo.js';
import {
  getMemberIds,
  isMember,
  markDelivered,
  markChatRead,
  receiptState,
  getMessage,
  getUserChats,
} from './chatRepo.js';

// Tracks every live socket per user. A user can be connected from several
// devices at once (phone + desktop), so we keep a Set per user id.
const sockets = new Map(); // userId -> Set<ws>
const typing = new Map(); // chatId -> Map<userId, timeoutHandle>

export function isOnline(userId) {
  return sockets.has(userId) && sockets.get(userId).size > 0;
}

export function onlineUserIds() {
  return [...sockets.keys()];
}

function addSocket(userId, ws) {
  if (!sockets.has(userId)) sockets.set(userId, new Set());
  sockets.get(userId).add(ws);
}

function removeSocket(userId, ws) {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sockets.delete(userId);
}

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

// Push an event to every socket of a single user.
export function sendToUser(userId, type, payload) {
  const set = sockets.get(userId);
  if (!set) return;
  for (const ws of set) send(ws, type, payload);
}

// Push to every member of a chat (optionally excluding one user).
export function broadcastToChat(chatId, type, payload, exceptUserId = null) {
  for (const memberId of getMemberIds(chatId)) {
    if (memberId !== exceptUserId) sendToUser(memberId, type, payload);
  }
}

// Tell everyone who shares a chat with this user about their presence change.
function broadcastPresence(userId) {
  const online = isOnline(userId);
  const user = getUserById(userId);
  const seen = new Set();
  // Peers = members of any chat this user belongs to.
  for (const chat of getUserChats(userId)) {
    for (const memberId of getMemberIds(chat.id)) {
      if (memberId === userId || seen.has(memberId)) continue;
      seen.add(memberId);
      sendToUser(memberId, 'presence', {
        userId,
        online,
        lastSeen: user?.last_seen ?? null,
      });
    }
  }
}

function setTyping(chatId, userId, isTyping) {
  if (!typing.has(chatId)) typing.set(chatId, new Map());
  const chatTyping = typing.get(chatId);
  const existing = chatTyping.get(userId);
  if (existing) clearTimeout(existing);

  if (isTyping) {
    // Auto-clear after 6s in case we never get a "stop" (app killed, etc.).
    const handle = setTimeout(() => {
      chatTyping.delete(userId);
      broadcastToChat(chatId, 'typing', { chatId, userId, typing: false }, userId);
    }, 6000);
    chatTyping.set(userId, handle);
  } else {
    chatTyping.delete(userId);
  }
  broadcastToChat(chatId, 'typing', { chatId, userId, typing: isTyping }, userId);
}

export function createHub(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Authenticate from the ?token= query param (browsers can't set headers on
    // a WebSocket handshake, and it keeps the mobile client simple).
    let token = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      token = url.searchParams.get('token');
    } catch {
      /* ignore malformed urls */
    }
    const payload = token ? verifyToken(token) : null;
    const user = payload ? getUserById(payload.sub) : null;
    if (!user) {
      send(ws, 'error', { message: 'Authentifizierung fehlgeschlagen.' });
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.userId = user.id;
    ws.isAlive = true;
    addSocket(user.id, ws);
    touchLastSeen(user.id);

    send(ws, 'ready', {
      user: publicUser(getUserById(user.id)),
      online: onlineUserIds(),
    });
    broadcastPresence(user.id);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, 'error', { message: 'Ungültige Nachricht.' });
      }
      handleMessage(ws, msg).catch(() => {
        send(ws, 'error', { message: 'Etwas ist schiefgelaufen.' });
      });
    });

    ws.on('close', () => {
      removeSocket(user.id, ws);
      touchLastSeen(user.id);
      // Clear any typing state from this user.
      for (const [chatId, map] of typing) {
        if (map.has(user.id)) {
          clearTimeout(map.get(user.id));
          map.delete(user.id);
          broadcastToChat(chatId, 'typing', { chatId, userId: user.id, typing: false }, user.id);
        }
      }
      broadcastPresence(user.id);
    });
  });

  // Heartbeat: drop sockets that stopped answering pings.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* socket already gone */
      }
    }
  }, 15000);

  wss.on('close', () => clearInterval(interval));
  return wss;
}

async function handleMessage(ws, msg) {
  const userId = ws.userId;
  const { type, payload = {} } = msg;

  switch (type) {
    case 'typing': {
      const { chatId, typing: isTyping } = payload;
      if (chatId && isMember(chatId, userId)) {
        setTyping(chatId, userId, !!isTyping);
      }
      break;
    }
    case 'delivered': {
      // Client acknowledges it has received messages for a chat.
      const { chatId } = payload;
      if (chatId && isMember(chatId, userId)) {
        const { senders } = markDelivered(chatId, userId);
        notifyReceipts(senders);
      }
      break;
    }
    case 'read': {
      const { chatId } = payload;
      if (chatId && isMember(chatId, userId)) {
        const { messageIds, senders } = markChatRead(chatId, userId);
        notifyReceipts(senders);
        // Let other devices of THIS user clear the unread badge too.
        sendToUser(userId, 'read-self', { chatId, messageIds });
      }
      break;
    }
    case 'ping':
      send(ws, 'pong', {});
      break;
    default:
      send(ws, 'error', { message: `Unbekannter Nachrichtentyp: ${type}` });
  }
}

// After delivery/read flips, tell each affected author the new aggregate
// status of their messages so their ticks update live.
function notifyReceipts(senders) {
  const byMessage = new Map();
  for (const { message_id, sender_id } of senders) {
    if (!sender_id) continue;
    byMessage.set(message_id, sender_id);
  }
  for (const [messageId, senderId] of byMessage) {
    const m = getMessage(messageId);
    if (!m) continue;
    sendToUser(senderId, 'receipt', {
      chatId: m.chat_id,
      messageId,
      status: receiptState(messageId),
    });
  }
}
