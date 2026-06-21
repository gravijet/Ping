// Inline translation (0.34.0) — private by default. Proxies to a self-hosted
// LibreTranslate instance (LIBRETRANSLATE_URL, optional LIBRETRANSLATE_KEY) so
// message text never reaches a third-party cloud. With nothing configured the
// feature reports as unavailable and the UI hides the action. The server proxy
// (rather than a direct client call) keeps the instance private and CORS-free.

export function translationEnabled() {
  return !!process.env.LIBRETRANSLATE_URL;
}

/**
 * Translate `text` into `target` (e.g. 'de'), optionally from `source` ('auto'
 * by default). Resolves to { text, detected } or throws an Error with a German
 * message the route surfaces as a 502/503.
 */
export async function translateText(text, target, source = 'auto') {
  if (!translationEnabled()) {
    const e = new Error('Übersetzung ist nicht eingerichtet.');
    e.status = 503;
    throw e;
  }
  const base = process.env.LIBRETRANSLATE_URL.replace(/\/+$/, '');
  const body = {
    q: text,
    source,
    target,
    format: 'text',
    ...(process.env.LIBRETRANSLATE_KEY ? { api_key: process.env.LIBRETRANSLATE_KEY } : {}),
  };
  let res;
  try {
    res = await fetch(`${base}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    const e = new Error('Übersetzungsdienst nicht erreichbar.');
    e.status = 502;
    throw e;
  }
  if (!res.ok) {
    const e = new Error('Übersetzung fehlgeschlagen.');
    e.status = 502;
    throw e;
  }
  const data = await res.json();
  return {
    text: data.translatedText || '',
    detected: data.detectedLanguage?.language || (source === 'auto' ? null : source),
  };
}
