import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for availability polls ("Terminfindung", type='availpoll'). Like polls
// and events, it is backed by a normal message; options + per-slot votes live in
// the two side-tables and ride along in messageView.availpoll. Members mark
// yes/maybe/no per slot; the organiser locks the winning slot, which spawns a
// real 'event' message (wired up in routes.js) and closes the poll.

const VOTES = new Set(['yes', 'maybe', 'no']);

const s = {
  insert: db.prepare(`
    INSERT INTO availpolls (id, message_id, chat_id, creator_id, title, location, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @location, @createdAt)`),
  insertOption: db.prepare(
    'INSERT INTO availpoll_options (id, availpoll_id, start_at, sort) VALUES (?, ?, ?, ?)'
  ),
  byId: db.prepare('SELECT * FROM availpolls WHERE id = ?'),
  byMessage: db.prepare('SELECT * FROM availpolls WHERE message_id = ?'),
  options: db.prepare(
    'SELECT * FROM availpoll_options WHERE availpoll_id = ? ORDER BY sort, start_at'
  ),
  optionById: db.prepare('SELECT * FROM availpoll_options WHERE id = ?'),
  votesForOption: db.prepare(`
    SELECT v.user_id AS userId, v.vote, u.display_name AS name
      FROM availpoll_votes v JOIN users u ON u.id = v.user_id
     WHERE v.option_id = ?`),
  myVote: db.prepare('SELECT vote FROM availpoll_votes WHERE option_id = ? AND user_id = ?'),
  setVote: db.prepare(`
    INSERT INTO availpoll_votes (option_id, user_id, vote, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(option_id, user_id) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`),
  clearVote: db.prepare('DELETE FROM availpoll_votes WHERE option_id = ? AND user_id = ?'),
  close: db.prepare(
    'UPDATE availpolls SET closed = 1, chosen_option_id = ?, event_message_id = ? WHERE id = ?'
  ),
};

/** Create the availpoll + its option rows backing an 'availpoll' message. */
export function createAvailPoll({ messageId, chatId, creatorId, title, location = '', options = [] }) {
  const id = uid();
  s.insert.run({ id, messageId, chatId, creatorId, title, location, createdAt: now() });
  options.forEach((startAt, i) => s.insertOption.run(uid(), id, startAt, i));
  return s.byId.get(id);
}

export const getAvailPollByMessage = (messageId) => s.byMessage.get(messageId);

/** Set (or, with vote=null, clear) a viewer's vote for one slot. */
export function setAvailVote(messageId, optionId, userId, vote) {
  const poll = s.byMessage.get(messageId);
  if (!poll || poll.closed) return false;
  const opt = s.optionById.get(optionId);
  if (!opt || opt.availpoll_id !== poll.id) return false;
  if (vote === null) {
    s.clearVote.run(optionId, userId);
    return true;
  }
  if (!VOTES.has(vote)) return false;
  s.setVote.run(optionId, userId, vote, now());
  return true;
}

/** Close the poll, recording the chosen slot + the event message it spawned. */
export function closeAvailPoll(messageId, optionId, eventMessageId) {
  const poll = s.byMessage.get(messageId);
  if (!poll) return null;
  const opt = s.optionById.get(optionId);
  if (!opt || opt.availpoll_id !== poll.id) return null;
  s.close.run(optionId, eventMessageId, poll.id);
  return { startAt: opt.start_at };
}

/** The poll as one viewer sees it: per-slot tallies, own votes, the front-runner. */
export function availPollView(messageId, viewerId) {
  const poll = s.byMessage.get(messageId);
  if (!poll) return null;
  let best = null;
  const options = s.options.all(poll.id).map((opt) => {
    const counts = { yes: 0, maybe: 0, no: 0 };
    const yesNames = [];
    for (const v of s.votesForOption.all(opt.id)) {
      if (v.vote in counts) counts[v.vote] += 1;
      if (v.vote === 'yes') yesNames.push(v.name);
    }
    // Front-runner score: a "yes" counts double a "maybe"; "no" never helps.
    const score = counts.yes * 2 + counts.maybe;
    const view = {
      id: opt.id,
      startAt: opt.start_at,
      counts,
      yesNames,
      myVote: s.myVote.get(opt.id, viewerId)?.vote || null,
      score,
    };
    if (!best || score > best.score || (score === best.score && opt.start_at < best.startAt)) {
      best = view;
    }
    return view;
  });
  return {
    id: poll.id,
    title: poll.title,
    location: poll.location || '',
    closed: !!poll.closed,
    chosenOptionId: poll.chosen_option_id || null,
    eventMessageId: poll.event_message_id || null,
    creatorId: poll.creator_id,
    options,
    // Only surface a suggestion while the poll is open and someone has voted.
    bestOptionId: !poll.closed && best && best.score > 0 ? best.id : null,
  };
}
