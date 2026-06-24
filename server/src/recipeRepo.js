import { db, now, safeJson } from './db.js';
import { uid } from './repo.js';

// Recipe card (type='recipe'): ingredients + steps as JSON arrays of strings,
// plus optional servings + prep minutes. A static card — no interaction beyond
// "kochen" (a client-side step-by-step view).

const s = {
  insert: db.prepare(`
    INSERT INTO recipes (id, message_id, chat_id, creator_id, title, servings, minutes, ingredients, steps, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @servings, @minutes, @ingredients, @steps, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM recipes WHERE message_id = ?'),
};

export function createRecipe({ messageId, chatId, creatorId, title, servings = 0, minutes = 0, ingredients = [], steps = [] }) {
  s.insert.run({
    id: uid(), messageId, chatId, creatorId, title,
    servings: servings | 0, minutes: minutes | 0,
    ingredients: JSON.stringify(ingredients), steps: JSON.stringify(steps), createdAt: now(),
  });
  return s.byMessage.get(messageId);
}

export function recipeView(messageId) {
  const r = s.byMessage.get(messageId);
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    servings: r.servings || 0,
    minutes: r.minutes || 0,
    ingredients: safeJson(r.ingredients, []),
    steps: safeJson(r.steps, []),
    creatorId: r.creator_id,
  };
}
