/* skeleton.js — content placeholders shown while data loads. A shimmering grey
   silhouette reads as "loading, structure incoming" far better than a spinner
   or a blank pane, and prevents the layout from jumping when content arrives.
   Pure DOM (the .sk-* shimmer styles live in styles.css) — no state. */

import { el } from './ui.js';

function bar(width, height = 12) {
  return el('span', { class: 'sk-bar', style: { width, height: height + 'px' } });
}

/** A skeleton standing in for one chat-list row (avatar + two text lines). */
export function skeletonChatRow() {
  return el('div', { class: 'sk-row', 'aria-hidden': 'true' }, [
    el('span', { class: 'sk-circle' }),
    el('div', { class: 'sk-lines' }, [
      bar('62%', 13),
      bar('40%', 11),
    ]),
  ]);
}

/** A list of skeleton chat rows. Returns a fragment ready to append. */
export function skeletonChatList(n = 8) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) frag.appendChild(skeletonChatRow());
  return frag;
}

/** Skeleton message bubbles, alternating incoming/outgoing for realism. */
export function skeletonMessages(n = 6) {
  const wrap = el('div', { class: 'sk-thread', 'aria-hidden': 'true' });
  const widths = ['48%', '66%', '35%', '72%', '52%', '60%'];
  for (let i = 0; i < n; i++) {
    const mine = i % 3 === 0;
    wrap.appendChild(el('div', { class: `sk-bubble ${mine ? 'mine' : ''}`,
      style: { width: widths[i % widths.length] } }));
  }
  return wrap;
}
