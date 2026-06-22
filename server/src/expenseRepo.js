import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for shared expenses ("Geteilte Kasse", type='expense'). Like polls and
// events, an expense is backed by a normal message; the who-owes-what payload
// lives in expense_shares and rides along in messageView.expense, so all the
// realtime/offline/search plumbing comes for free.
//
// The per-chat ledger derives net balances purely from the rows: every expense
// credits its payer the full amount and debits each participant their share. A
// 'settlement' (one member paying another to clear a debt) is the very same
// shape — payer pays, a single beneficiary "owes" the whole amount — so one net
// formula covers both:  net(u) = Σ(paid by u) − Σ(u's shares).
// Positive net = the group owes u; negative = u owes the group.

const KINDS = new Set(['expense', 'settlement']);

const s = {
  insert: db.prepare(`
    INSERT INTO expenses
      (id, message_id, chat_id, creator_id, payer_id, title, amount_cents, currency, kind, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @payerId, @title, @amountCents, @currency, @kind, @createdAt)`),
  insertShare: db.prepare(
    'INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)'
  ),
  byId: db.prepare('SELECT * FROM expenses WHERE id = ?'),
  byMessage: db.prepare('SELECT * FROM expenses WHERE message_id = ?'),
  shares: db.prepare(`
    SELECT sh.user_id AS userId, sh.share_cents AS shareCents, u.display_name AS name
      FROM expense_shares sh JOIN users u ON u.id = sh.user_id
     WHERE sh.expense_id = ?
     ORDER BY u.display_name`),
  // Live (non-deleted) expense rows for a chat, with the payer's name.
  liveForChat: db.prepare(`
    SELECT e.*, u.display_name AS payerName
      FROM expenses e
      JOIN messages m ON m.id = e.message_id
      JOIN users u ON u.id = e.payer_id
     WHERE e.chat_id = ? AND m.deleted_at IS NULL
     ORDER BY e.created_at`),
  // Chats where the viewer has any expense activity (for the cross-chat overview).
  chatsWithActivity: db.prepare(`
    SELECT DISTINCT e.chat_id AS chatId
      FROM expenses e
      JOIN messages m ON m.id = e.message_id
     WHERE m.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = e.chat_id AND cm.user_id = ?)`),
  nameOf: db.prepare('SELECT display_name AS name FROM users WHERE id = ?'),
};

/**
 * Create the expense row + its share rows backing a freshly-created 'expense'
 * message. `shares` is [{ userId, shareCents }] and must sum to amountCents.
 */
export function createExpense({
  messageId,
  chatId,
  creatorId,
  payerId,
  title,
  amountCents,
  currency = 'EUR',
  kind = 'expense',
  shares = [],
}) {
  const id = uid();
  s.insert.run({
    id,
    messageId,
    chatId,
    creatorId,
    payerId,
    title,
    amountCents,
    currency,
    kind: KINDS.has(kind) ? kind : 'expense',
    createdAt: now(),
  });
  for (const sh of shares) {
    if (sh.shareCents !== 0) s.insertShare.run(id, sh.userId, sh.shareCents);
  }
  return s.byId.get(id);
}

export const getExpenseByMessage = (messageId) => s.byMessage.get(messageId);

/** The expense as one viewer sees it: payer, amount, per-participant shares. */
export function expenseView(messageId, viewerId) {
  const e = s.byMessage.get(messageId);
  if (!e) return null;
  const shares = s.shares.all(e.id);
  const mine = shares.find((sh) => sh.userId === viewerId);
  return {
    id: e.id,
    title: e.title,
    amountCents: e.amount_cents,
    currency: e.currency,
    kind: e.kind,
    payerId: e.payer_id,
    payerName: s.nameOf.get(e.payer_id)?.name || '',
    creatorId: e.creator_id,
    shares,
    myShare: mine ? mine.shareCents : 0,
    iPaid: e.payer_id === viewerId,
    createdAt: e.created_at,
  };
}

/**
 * Reduce a set of net balances (which sum to ~zero) to the minimal list of
 * "who pays whom" transfers, greedily matching the biggest creditor with the
 * biggest debtor. Amounts in minor units. Pure — no DB access.
 */
export function settleUp(netByUser) {
  const creditors = [];
  const debtors = [];
  for (const [userId, net] of Object.entries(netByUser)) {
    if (net > 0) creditors.push({ userId, amt: net });
    else if (net < 0) debtors.push({ userId, amt: -net });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const pay = Math.min(c.amt, d.amt);
    if (pay > 0) transfers.push({ from: d.userId, to: c.userId, amount: pay });
    c.amt -= pay;
    d.amt -= pay;
    if (c.amt <= 0) ci += 1;
    if (d.amt <= 0) di += 1;
  }
  return transfers;
}

/**
 * The full ledger for one chat, grouped by currency (most chats use one). Each
 * group carries every member's net balance plus the minimal settle-up transfers.
 */
export function chatLedger(chatId) {
  const rows = s.liveForChat.all(chatId);
  // currency -> { netByUser, names, totalSpent (real expenses only) }
  const groups = new Map();
  const ensure = (cur) => {
    if (!groups.has(cur)) groups.set(cur, { net: {}, names: {}, total: 0 });
    return groups.get(cur);
  };
  const note = (g, userId, name) => {
    if (!(userId in g.net)) g.net[userId] = 0;
    if (name) g.names[userId] = name;
  };
  for (const e of rows) {
    const g = ensure(e.currency);
    note(g, e.payer_id, e.payerName);
    g.net[e.payer_id] += e.amount_cents;
    if (e.kind === 'expense') g.total += e.amount_cents;
    for (const sh of s.shares.all(e.id)) {
      note(g, sh.userId, sh.name);
      g.net[sh.userId] -= sh.shareCents;
    }
  }
  return [...groups.entries()].map(([currency, g]) => ({
    currency,
    totalSpent: g.total,
    balances: Object.entries(g.net)
      .map(([userId, net]) => ({ userId, name: g.names[userId] || '', net }))
      .sort((a, b) => b.net - a.net),
    settlements: settleUp(g.net).map((t) => ({
      ...t,
      fromName: g.names[t.from] || '',
      toName: g.names[t.to] || '',
    })),
  }));
}

/**
 * Cross-chat overview: for every chat with expense activity the user belongs to,
 * the user's own net balance per currency. Powers the "Kasse" agenda surface.
 */
export function userLedger(userId, titleOf) {
  const out = [];
  for (const { chatId } of s.chatsWithActivity.all(userId)) {
    for (const g of chatLedger(chatId)) {
      const mine = g.balances.find((b) => b.userId === userId);
      const net = mine ? mine.net : 0;
      if (net === 0) continue;
      out.push({
        chatId,
        chatTitle: titleOf ? titleOf(chatId) : '',
        currency: g.currency,
        net,
      });
    }
  }
  // Biggest absolute balance first.
  out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return out;
}
