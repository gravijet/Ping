/* emoji.js — a tiny categorised emoji picker. Pure client-side: opens a popup
   anchored near a button and calls onPick(emoji) for each tap. Used by the chat
   composer and the reaction picker. */

import { el, clear } from './ui.js';

const CATS = {
  '🙂': ['😀','😁','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤨','🧐','😎','🤩','🥳','😏','😢','😭','😤','😠','🤯','😱','😳','🥺','😴','🤤','😷','🤒','🤔','🤗','🤭','🤫','😶','😐','😬','🙄','😮','😲','🥱','😅','😆','🙃','🫠'],
  '👍': ['👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','🙏','💪','🤝','👋','✋','🖐️','🤚','👈','👉','👆','👇','☝️','✊','👊','🫶','💅','🦾','👀','🧠','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','🔥','💯'],
  '🎉': ['🎉','🎊','🥳','🎂','🎁','🎈','✨','⭐','🌟','💫','🏆','🥇','🎮','🎯','🎵','🎶','🎤','🎧','📷','📸','🎬','💡','🔔','📣','🚀','💎','👑','🌈','☀️','🌙','⚡','❄️','💧','🌊','🍀','🌹','🌸','🌻','🍕','🍔','🍟','🌮','🍣','☕','🍺','🍷'],
  '🐶': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦄','🐴','🐢','🐙','🐳','🐬','🐠','🦋','🐝','🌍','🌳','🌵','⛰️','🏖️','🌅','🚗','✈️','🚲','⚽','🏀','🎾','🏐','🎲','♟️','🧩','🎸','📚'],
};

let pop = null;
export function closeEmoji() {
  if (pop) { pop.remove(); pop = null; document.removeEventListener('click', onDoc, true); }
}
function onDoc(e) { if (pop && !pop.contains(e.target)) closeEmoji(); }

export function openEmojiPicker(anchor, onPick) {
  closeEmoji();
  const grid = el('div', { class: 'emoji-grid' });
  const tabs = el('div', { class: 'emoji-tabs' });
  const names = Object.keys(CATS);
  const fill = (cat) => {
    clear(grid);
    for (const e of CATS[cat]) {
      grid.appendChild(el('button', { type: 'button', text: e,
        onClick: (ev) => { ev.stopPropagation(); onPick(e); } }));
    }
  };
  names.forEach((c, i) => {
    const t = el('button', { type: 'button', class: i === 0 ? 'on' : '', text: c,
      onClick: (ev) => { ev.stopPropagation();
        tabs.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
        t.classList.add('on'); fill(c); } });
    tabs.appendChild(t);
  });
  fill(names[0]);

  pop = el('div', { class: 'emoji-pop' }, [tabs, grid]);
  document.body.appendChild(pop);

  // Position above the anchor, clamped to the viewport.
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const left = Math.min(r.left, innerWidth - pr.width - 10);
  let top = r.top - pr.height - 8;
  if (top < 10) top = r.bottom + 8;
  pop.style.left = Math.max(10, left) + 'px';
  pop.style.top = top + 'px';

  setTimeout(() => document.addEventListener('click', onDoc, true), 0);
}
