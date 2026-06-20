/* linkpreview.js — rich OpenGraph preview cards under chat messages (0.28.0
   "Kontext"). The first link in a message is unfurled lazily: the card hydrates
   only once the message scrolls into view (IntersectionObserver), results are
   memoised per URL for the session, and the thumbnail is dropped on data-saver
   connections. Gated by the linkPreviews flag. */

import { api } from './api.js';
import { el } from './ui.js';
import { flag } from './flags.js';
import { prefersDataSaver } from './device.js';

// url -> Promise<preview|null>. One in-flight request per URL, shared across
// every message (and chat) that links to it.
const cache = new Map();

const URL_RE = /(https?:\/\/[^\s<]+)/i;

/** The first http(s) URL in a message body, with trailing punctuation trimmed
    (a regex tends to swallow the `.`/`)` that ends a sentence). */
export function firstUrl(text) {
  if (!text) return null;
  const m = String(text).match(URL_RE);
  if (!m) return null;
  return m[1].replace(/[)\]}.,;:!?'"»›]+$/, '') || null;
}

function load(url) {
  if (cache.has(url)) return cache.get(url);
  const p = api
    .get(`/link-preview?url=${encodeURIComponent(url)}`)
    .then((r) => r?.preview || null)
    .catch(() => null);
  cache.set(url, p);
  return p;
}

let io = null;
function observer() {
  if (io) return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        hydrate(e.target);
      }
    },
    { rootMargin: '250px 0px' }
  );
  return io;
}

/** Append a lazy preview slot for [url] to [container]. The card fills in once
    the slot scrolls into view and metadata resolves; an empty result removes the
    slot, so a link with no preview leaves no trace. */
export function attachLinkPreview(container, url) {
  if (!flag('linkPreviews') || !url) return;
  const slot = el('div', { class: 'link-preview-slot' });
  slot.dataset.url = url;
  container.appendChild(slot);
  if (typeof IntersectionObserver === 'undefined') hydrate(slot);
  else observer().observe(slot);
}

async function hydrate(slot) {
  const url = slot.dataset.url;
  if (!url || slot.dataset.done) return;
  slot.dataset.done = '1';
  const preview = await load(url);
  if (!preview || !preview.title) {
    slot.remove();
    return;
  }
  slot.replaceChildren(renderCard(preview, url));
}

function renderCard(p, url) {
  const href = p.url || url;
  const card = el('a', {
    class: 'link-preview',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: href,
  });
  // Thumbnail — skipped when the user is saving data. Removed if it 404s/blocks
  // so a broken image never leaves an empty grey box.
  if (p.image && !(flag('adaptiveData') && prefersDataSaver())) {
    const img = el('img', {
      class: 'lp-img',
      src: p.image,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
    img.addEventListener('error', () => img.remove());
    card.appendChild(img);
  }
  card.appendChild(
    el('div', { class: 'lp-text' }, [
      p.siteName ? el('div', { class: 'lp-site', text: p.siteName }) : null,
      el('div', { class: 'lp-title', text: p.title }),
      p.description ? el('div', { class: 'lp-desc', text: p.description }) : null,
    ].filter(Boolean))
  );
  return card;
}
