// Local assistant (Pillar D) — strictly on-device / self-hosted, no data egress.
//
// If OLLAMA_URL is set (e.g. http://127.0.0.1:11434), the assistant proxies the
// prompt to that *local* model and returns its reply. Otherwise it falls back to
// a tiny rule-based responder so the @ping bot still does something useful
// without any model installed. Nothing here ever calls a third-party cloud API —
// that is a deliberate design constraint of Ping (see CLAUDE.md / memory).

const OLLAMA_URL = process.env.OLLAMA_URL || '';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

export const assistantEnabled = () => true; // heuristic mode always available

async function askOllama(prompt) {
  if (!OLLAMA_URL) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.response || '').trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// A deliberately small, predictable heuristic responder for when no local model
// is configured. It handles the few things people actually ask a chat bot.
function heuristicReply(prompt, context = []) {
  const p = (prompt || '').toLowerCase().trim();
  if (/\b(hallo|hi|hey|moin|servus|hallo ping)\b/.test(p)) {
    return 'Hallo! 👋 Ich bin der lokale Ping-Assistent. Ich laufe komplett auf diesem Server — frag mich nach einer Zusammenfassung, der Uhrzeit oder Hilfe.';
  }
  if (/(uhrzeit|wie spät|datum|welcher tag)/.test(p)) {
    return `Es ist ${new Date().toLocaleString('de-DE')}.`;
  }
  if (/(zusammenfass|fasse.*zusammen|worum geht|catch ?up)/.test(p)) {
    const recent = context.slice(-12).map((m) => m.body).filter(Boolean);
    if (!recent.length) return 'Hier gibt es noch nichts zusammenzufassen.';
    const bullets = recent.slice(-5).map((b) => '• ' + (b.length > 80 ? b.slice(0, 79) + '…' : b));
    return 'Kurzfassung der letzten Nachrichten:\n' + bullets.join('\n');
  }
  if (/(hilfe|help|was kannst du|befehle)/.test(p)) {
    return 'Ich kann (lokal!): den Chat zusammenfassen, die Uhrzeit nennen und einfache Fragen beantworten. Für mehr kannst du auf dem Server OLLAMA_URL setzen, dann nutze ich ein lokales Modell.';
  }
  if (/\?$/.test(p)) {
    return 'Gute Frage! Ohne lokales Modell (OLLAMA_URL) kann ich darauf nur eingeschränkt antworten — aber ich leite sie gerne als Notiz weiter. 🙂';
  }
  return 'Verstanden. (Hinweis: Für echte Antworten ein lokales Modell via OLLAMA_URL einrichten — es bleibt alles auf diesem Server.)';
}

/**
 * Produce an assistant reply for [prompt]. [context] is an array of recent
 * { senderId, body } for grounding. Tries a local model first, else heuristic.
 */
export async function assistantReply(prompt, context = []) {
  if (OLLAMA_URL) {
    const recent = context.slice(-12).map((m) => `- ${m.body}`).join('\n');
    const full = `Du bist ein hilfreicher, knapper Chat-Assistent. Antworte auf Deutsch.\n\nLetzte Nachrichten:\n${recent}\n\nFrage: ${prompt}\nAntwort:`;
    const reply = await askOllama(full);
    if (reply) return reply;
  }
  return heuristicReply(prompt, context);
}
