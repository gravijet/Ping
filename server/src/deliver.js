import { createMessage, getMembers, getMemberIds, messageView } from './chatRepo.js';
import { getUserById, hasBlocked, OFFICIAL_USER_ID } from './repo.js';
import { sendToUser, isOnline } from './hub.js';
import { sendPushToUsers } from './push.js';
import {
  filterAudible,
  getFocus,
  isUserSilenced,
  shouldAutoReply,
  markAutoReplied,
} from './focusRepo.js';

// Shared message-delivery primitive used by the live send route, the scheduled-
// message sweeper and any other place that needs to put a real message into a
// chat: persist it, fan it out to every member's sockets (per-member view), and
// push to members who are offline and haven't muted the chat.

function previewOf(msg) {
  // Encrypted messages must never leak plaintext into a notification.
  if (msg.enc) return '🔒 Verschlüsselte Nachricht';
  // View-once media is teased generically so the preview can't reveal it.
  if (msg.view_once) return '👁️ Einmal ansehen';
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
    case 'event':
      return '📅 Termin';
    case 'tasklist':
      return '✅ Aufgabenliste';
    case 'sticker':
      return '🩷 Sticker';
    case 'board':
      return '📋 Board';
    case 'game':
      return '🎮 Spiel';
    case 'livelocation':
      return '📍 Live-Standort';
    case 'contact':
      return '👤 Kontakt';
    case 'code':
      return '‹/› Code-Snippet';
    case 'expense':
      return '💶 Ausgabe';
    case 'availpoll':
      return '🗓️ Terminfindung';
    default:
      return msg.body || 'Nachricht';
  }
}

/** Push a freshly delivered message to offline, non-muted members. */
export function pushMessage(chat, msg, senderId) {
  const sender = getUserById(senderId);
  const isGroup = chat.type === 'group';
  const offline = getMembers(chat.id)
    .filter((m) => m.user_id !== senderId && !m.muted && !isOnline(m.user_id))
    .map((m) => m.user_id);
  // 0.30.0 "Finden & Fokus": hold back push for anyone in Focus or quiet hours.
  // They still get the message instantly over the live socket if they reconnect;
  // we just don't light up their device while they've asked to be left alone.
  const targets = filterAudible(offline);
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

/**
 * 0.30.0 "Finden & Fokus": when a direct message lands for someone who is in
 * Focus / quiet hours and has configured an auto-reply, send their canned reply
 * back into the conversation — once per peer per cool-down so a chatty contact
 * can't trigger a storm. DMs only (never groups or the locked official channel),
 * never to/from the official account, and respecting blocks in either direction.
 * The reply itself is delivered with { auto: true } so it can't recurse.
 */
export function maybeAutoReply(chat, incomingMsg, senderId) {
  if (chat.type !== 'direct' || chat.locked) return;
  if (incomingMsg.type === 'system') return;
  if (senderId === OFFICIAL_USER_ID) return;
  const recipientId = getMemberIds(chat.id).find((id) => id !== senderId);
  if (!recipientId || recipientId === senderId || recipientId === OFFICIAL_USER_ID) return;
  if (!isUserSilenced(recipientId)) return;
  const text = (getFocus(recipientId).autoReply || '').trim();
  if (!text) return;
  if (hasBlocked(recipientId, senderId) || hasBlocked(senderId, recipientId)) return;
  if (!shouldAutoReply(recipientId, senderId)) return;
  markAutoReplied(recipientId, senderId);
  deliverMessage(chat, { senderId: recipientId, body: text, auto: true });
}

/** Create + deliver a message into [chat]. Returns the stored message row. */
export function deliverMessage(
  chat,
  { senderId, type = 'text', body = '', attachment = null, replyTo = null, expiresAt = null, auto = false }
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
  // Auto-replies are themselves delivered messages; never let one trigger another.
  if (!auto) maybeAutoReply(chat, msg, senderId);
  return msg;
}
