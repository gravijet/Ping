import { spawn } from 'node:child_process';
import { db, now } from './db.js';
import { config } from './config.js';

// Voice-note transcription (0.34.0) — fully on-prem and private. When a voice
// message arrives we record a 'pending' row; if a local Whisper binary is
// configured (WHISPER_BIN, optional WHISPER_MODEL), a worker shells out to it and
// fills the text in. With nothing configured the feature degrades silently: the
// row stays 'pending' and the UI simply shows no transcript. No audio ever leaves
// the host — there is no cloud call anywhere in this path.

const s = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO voice_transcripts (message_id, text, lang, status, created_at, updated_at)
    VALUES (?, '', '', 'pending', ?, ?)`),
  setText: db.prepare(`
    UPDATE voice_transcripts SET text = ?, lang = ?, status = 'done', updated_at = ?
     WHERE message_id = ?`),
  setStatus: db.prepare(
    'UPDATE voice_transcripts SET status = ?, updated_at = ? WHERE message_id = ?'
  ),
  get: db.prepare('SELECT * FROM voice_transcripts WHERE message_id = ?'),
};

export function transcriptionEnabled() {
  return !!process.env.WHISPER_BIN;
}

/** The transcript payload for a voice message, or null if none recorded. */
export function transcriptView(messageId) {
  const row = s.get.get(messageId);
  if (!row) return null;
  return { status: row.status, text: row.text || '', lang: row.lang || '' };
}

/**
 * Queue a voice message for transcription. `onDone(text)` (optional) lets the
 * caller persist the text into messages.body so it becomes searchable + lets the
 * client refresh the bubble. Returns immediately; work happens off the hot path.
 */
export function queueTranscription(messageId, audioPath, onDone) {
  s.insert.run(messageId, now(), now());
  if (!transcriptionEnabled() || !audioPath) return;
  const bin = process.env.WHISPER_BIN;
  const model = process.env.WHISPER_MODEL || '';
  const args = model ? ['-m', model, '-otxt', '-f', audioPath] : ['-otxt', '-f', audioPath];
  let out = '';
  try {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => s.setStatus.run('error', now(), messageId));
    child.on('close', (code) => {
      const text = out.trim();
      if (code === 0 && text) {
        s.setText.run(text, '', now(), messageId);
        try { onDone?.(text); } catch { /* best-effort */ }
      } else {
        s.setStatus.run('error', now(), messageId);
      }
    });
  } catch {
    s.setStatus.run('error', now(), messageId);
  }
}

// Re-export so callers don't have to know the config layout.
export const transcriptionConfig = () => ({
  enabled: transcriptionEnabled(),
  bin: process.env.WHISPER_BIN || null,
});
void config;
