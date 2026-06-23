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
  if (msg.type === 'contact') return '👤 ' + (msg.contact?.displayName || 'Kontakt');
  if (msg.type === 'code') return '‹/› ' + (msg.code?.filename || msg.code?.language || 'Code-Snippet');
  // 0.38.0 "Universum": the new structured/media types.
  if (msg.type === 'whiteboard') return '🎨 ' + (msg.whiteboard?.title || 'Whiteboard');
  if (msg.type === 'doc') return '📄 ' + (msg.doc?.title || 'Dokument');
  if (msg.type === 'playlist') return '🎵 ' + (msg.playlist?.title || 'Playlist');
  if (msg.type === 'recipe') return '🍳 ' + (msg.recipe?.title || 'Rezept');
  if (msg.type === 'flashcards') return '🃏 ' + (msg.flashcards?.title || 'Lernkarten');
  if (msg.type === 'form') return '📝 ' + (msg.form?.title || 'Formular');
  if (msg.type === 'bookmark') return '🔖 ' + (msg.bookmark?.title || 'Lesezeichen');
  if (msg.type === 'place') return '🗺️ ' + (msg.place?.title || 'Orte');
  if (msg.type === 'videonote') return '⭕ Videonotiz';
  if (msg.type === 'watchparty') return '🍿 ' + (msg.watchparty?.title || 'Kinoabend');
  if (msg.type === 'gift') return '🎁 Geschenk';
  if (msg.type === 'system') return msg.body || '';
  if (msg.attachment) {
    const lbl = attachmentLabel(msg.attachment);
    return msg.body ? `${lbl} · ${msg.body}` : lbl;
  }
  return msg.body || '';
}
