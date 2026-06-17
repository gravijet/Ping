/* format.js — shared message formatting helpers used by the chat list and the
   conversation view (preview text, attachment labels). */

export function attachmentLabel(att) {
  if (!att) return '';
  const kind = att.kind || '';
  if (kind === 'image') return '📷 Foto';
  if (kind === 'gif') return '🎞️ GIF';
  if (kind === 'video') return '🎥 Video';
  if (kind === 'voice') return '🎤 Sprachnachricht';
  if (kind === 'audio') return '🎵 Audio';
  return '📎 ' + (att.name || 'Datei');
}

// Short one-liner for a chat row / reply preview.
export function messagePreview(msg) {
  if (!msg) return '';
  if (msg.deleted) return 'Diese Nachricht wurde gelöscht';
  if (msg.type === 'poll') return '📊 ' + (msg.poll?.question || 'Umfrage');
  if (msg.type === 'system') return msg.body || '';
  if (msg.attachment) {
    const lbl = attachmentLabel(msg.attachment);
    return msg.body ? `${lbl} · ${msg.body}` : lbl;
  }
  return msg.body || '';
}
