import { db, now } from './db.js';
import { uid } from './repo.js';

// Form / survey (type='form'): a multi-question survey that goes beyond a single
// poll. Each question is { q, type:'text'|'choice'|'rating', options? }. One
// response row per (form, user); answers is a JSON array aligned to questions.
// formView aggregates results (choice tallies, rating averages, text samples) so
// the card can show live results without a second round-trip.

const s = {
  insert: db.prepare(`
    INSERT INTO forms (id, message_id, chat_id, creator_id, title, questions, anonymous, closed, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @questions, @anonymous, 0, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM forms WHERE message_id = ?'),
  setClosed: db.prepare('UPDATE forms SET closed = ? WHERE id = ?'),
  upsertResponse: db.prepare(`
    INSERT INTO form_responses (form_id, user_id, answers, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(form_id, user_id) DO UPDATE SET answers = excluded.answers, created_at = excluded.created_at`),
  responses: db.prepare('SELECT * FROM form_responses WHERE form_id = ?'),
  myResponse: db.prepare('SELECT answers FROM form_responses WHERE form_id = ? AND user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM form_responses WHERE form_id = ?'),
};

export function createForm({ messageId, chatId, creatorId, title, questions, anonymous = false }) {
  s.insert.run({
    id: uid(), messageId, chatId, creatorId, title,
    questions: JSON.stringify(questions), anonymous: anonymous ? 1 : 0, createdAt: now(),
  });
  return s.byMessage.get(messageId);
}

/** Record (or overwrite) a viewer's answers. Returns false if missing/closed. */
export function submitFormResponse(messageId, userId, answers) {
  const f = s.byMessage.get(messageId);
  if (!f || f.closed) return false;
  s.upsertResponse.run(f.id, userId, JSON.stringify(answers), now());
  return true;
}

export function closeForm(messageId, closed = true) {
  const f = s.byMessage.get(messageId);
  if (!f) return false;
  s.setClosed.run(closed ? 1 : 0, f.id);
  return true;
}

export function formView(messageId, viewerId) {
  const f = s.byMessage.get(messageId);
  if (!f) return null;
  const questions = JSON.parse(f.questions);
  const responses = s.responses.all(f.id).map((r) => JSON.parse(r.answers));
  // Aggregate per question.
  const results = questions.map((q, qi) => {
    const vals = responses.map((a) => a[qi]).filter((v) => v != null && v !== '');
    if (q.type === 'choice') {
      const tally = {};
      for (const opt of q.options || []) tally[opt] = 0;
      for (const v of vals) tally[v] = (tally[v] || 0) + 1;
      return { tally };
    }
    if (q.type === 'rating') {
      const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      return { avg: Math.round(avg * 10) / 10, n: nums.length };
    }
    return { samples: vals.slice(0, 20) };
  });
  return {
    id: f.id,
    title: f.title,
    questions,
    anonymous: !!f.anonymous,
    closed: !!f.closed,
    creatorId: f.creator_id,
    responseCount: s.count.get(f.id).n,
    results,
    myAnswers: s.myResponse.get(f.id, viewerId)?.answers
      ? JSON.parse(s.myResponse.get(f.id, viewerId).answers)
      : null,
  };
}
