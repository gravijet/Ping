import { db, now } from './db.js';
import { uid } from './repo.js';

// Flashcard deck (type='flashcards'): a study deck. Cards are front/back pairs;
// the client drives the quiz/review interaction locally, so the server just
// stores the deck and serves it via messageView.flashcards.

const MAX_CARDS = 500;

const s = {
  insertDeck: db.prepare(`
    INSERT INTO decks (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM decks WHERE message_id = ?'),
  insertCard: db.prepare(`
    INSERT INTO deck_cards (id, deck_id, front, back, sort) VALUES (@id, @deckId, @front, @back, @sort)`),
  cards: db.prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY sort'),
};

export function createDeck({ messageId, chatId, creatorId, title, cards = [] }) {
  const id = uid();
  s.insertDeck.run({ id, messageId, chatId, creatorId, title, createdAt: now() });
  cards.slice(0, MAX_CARDS).forEach((c, i) => {
    s.insertCard.run({ id: uid(), deckId: id, front: c.front, back: c.back, sort: i });
  });
  return s.byMessage.get(messageId);
}

export function deckView(messageId) {
  const d = s.byMessage.get(messageId);
  if (!d) return null;
  return {
    id: d.id,
    title: d.title,
    creatorId: d.creator_id,
    cards: s.cards.all(d.id).map((c) => ({ id: c.id, front: c.front, back: c.back })),
  };
}
