/* smartreplies.js — heuristic suggested quick replies (0.34.0). Rule-based, no
   model — the server derives 2-3 contextual one-tap replies from the last inbound
   message. Rendered as chips above the composer; picking one drops it into the
   input. 100% private (no content leaves the host). */

import { api } from './api.js';
import { el, clear } from './ui.js';

/** Load suggestions for [chatId] into [container]; [onPick] receives the text. */
export async function loadSmartReplies(chatId, container, onPick) {
  if (!container) return;
  clear(container);
  let suggestions = [];
  try { ({ suggestions } = await api.get(`/chats/${chatId}/smart-replies`)); }
  catch { return; }
  if (!suggestions?.length) return;
  for (const s of suggestions.slice(0, 3)) {
    container.append(el('button', { class: 'smart-chip', onClick: () => onPick?.(s) }, s));
  }
}
