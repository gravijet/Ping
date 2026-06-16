import { onlineUserIds, sendToUser } from './hub.js';
import { allPushTokens } from './pushRepo.js';
import { sendPushToUsers } from './push.js';
import { recordBroadcast } from './repo.js';

// Send an announcement to everyone: a live event to each connected client, and a
// phone push to everyone who is offline (so it reaches people with the app
// closed). Records the result in the broadcast history and returns the counts.
//
// Shared by the manual /admin/broadcast route and the maintenance sweep that
// fires scheduled broadcasts, so both behave identically.
export async function dispatchBroadcast({ title = '', body, route } = {}) {
  const t = title || 'Ping';
  const online = new Set(onlineUserIds());
  for (const id of online) {
    sendToUser(id, 'announcement', { title: t, body, route });
  }
  const offline = [...new Set(allPushTokens().map((r) => r.user_id))].filter(
    (id) => !online.has(id)
  );
  const pushed = await sendPushToUsers(offline, {
    title: t,
    body,
    data: { type: 'announcement', ...(route ? { route } : {}) },
  });
  recordBroadcast({ title: title || '', body, delivered: online.size, pushed });
  return { delivered: online.size, pushed };
}
