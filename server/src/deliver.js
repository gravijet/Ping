import { createMessage, getMembers, getMemberIds, messageView } from './chatRepo.js';
import { getUserById } from './repo.js';
import { sendToUser, isOnline } from './hub.js';
import { sendPushToUsers } from './push.js';

// Shared message-delivery primitive used by the live send route, the scheduled-
// message sweeper and any other place that needs to put a real message into a
// chat: persist it, fan it out to every member's sockets (per-member view), and
// push to members who are offline and haven't muted the chat.

function previewOf(msg) {
  if (msg.body && msg.body.trim()) return msg.body.trim();
  switch (msg.type) {
    case 'image':
      return '📷 Foto';
    case 'video':
      return '🎬 Video';
    case 'voice':
      return '🎤 Sprachnachricht';
    case 'audio':
      return '🎵 Audio';
    case 'gif':
      return 'GIF';
    case 'file':
      return '📎 Datei';
    case 'poll':
      return '📊 Umfrage';
    default:
      return msg.body || 'Nachricht';
  }
}

/** Push a freshly delivered message to offline, non-muted members. */
export function pushMessage(chat, msg, senderId) {
  const sender = getUserById(senderId);
  const isGroup = chat.type === 'group';
  const targets = getMembers(chat.id)
    .filter((m) => m.user_id !== senderId && !m.muted && !isOnline(m.user_id))
    .map((m) => m.user_id);
  if (targets.length === 0) return;
  const senderName = sender?.display_name || 'Ping';
  const p = previewOf(msg);
  sendPushToUsers(targets, {
    title: isGroup ? chat.name || 'Gruppe' : senderName,
    body: isGroup ? `${senderName}: ${p}` : p,
    // Let the app render this one itself so it can offer inline reply + mark-read
    // from the shade (see push.js). Title/body still reach Web Push unchanged.
    clientNotification: true,
    data: {
      type: 'message',
      chatId: chat.id,
      messageId: msg.id,
      senderId,
      senderName,
    },
  }).catch(() => {});
}

/** Create + deliver a message into [chat]. Returns the stored message row. */
export function deliverMessage(
  chat,
  { senderId, type = 'text', body = '', attachment = null, replyTo = null, expiresAt = null }
) {
  const msg = createMessage({
    chatId: chat.id,
    senderId,
    type,
    body: (body || '').trim(),
    attachment,
    replyTo,
    expiresAt,
  });
  for (const memberId of getMemberIds(chat.id)) {
    sendToUser(memberId, 'message', { message: messageView(msg, memberId) });
  }
  pushMessage(chat, msg, senderId);
  return msg;
}
