/* voice.js — record a voice message with the MediaRecorder API and hand back a
   File ready to upload. The composer (chat.js) drives the UI; this module owns
   the microphone + encoding mechanics. */

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of opts) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/// Start recording. Resolves a controller once the mic is live, or rejects if
/// permission is denied / unsupported. Controller:
///   stop()   -> Promise<{ file, durationMs }>
///   cancel() -> discard and release the mic
///   started  -> epoch ms the recording began
export async function startRecorder() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('Sprachaufnahme wird hier nicht unterstützt.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const started = Date.now();
  rec.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    started,
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        release();
        const type = mime || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `sprachnachricht.${ext}`, { type: blob.type });
        resolve({ file, durationMs: Date.now() - started });
      };
      try { rec.stop(); } catch { release(); resolve({ file: null, durationMs: 0 }); }
    }),
    cancel: () => { try { rec.onstop = null; rec.stop(); } catch { /* ignore */ } release(); },
  };
}
