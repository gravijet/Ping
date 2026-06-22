/* expense.js — "Geteilte Kasse" (shared expenses / split bills). An expense is a
   structured message (type 'expense'); the payer/amount/share payload rides
   along in message.expense. This module owns the create modal, the in-chat
   expense card, the per-chat ledger modal (net balances + one-tap settle-up) and
   the cross-chat "Kasse" pane. Mirrors the events/tasks pattern. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

/** Format minor units as localised currency, falling back gracefully. */
export function fmtMoney(cents, currency = 'EUR') {
  const v = (cents || 0) / 100;
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

/** Parse a "12,50" / "12.5" amount string into integer cents (NaN if invalid). */
function parseCents(str) {
  const n = parseFloat(String(str).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Everyone in the chat as {id, displayName, avatarColor} — works for DMs too. */
function chatMembers(chatId) {
  const chat = store.getChat(chatId) || {};
  if (chat.members && chat.members.length) return chat.members;
  const me = store.state.me;
  const list = [];
  if (me) list.push(me);
  if (chat.otherUser && chat.otherUser.id !== me?.id) list.push(chat.otherUser);
  return list;
}

const nameOf = (members, id) => members.find((u) => u.id === id)?.displayName || 'Jemand';

/** Modal to create a shared expense in [chatId]. */
export function newExpenseModal(chatId) {
  const members = chatMembers(chatId);
  const me = store.state.me;

  const title = el('input', { class: 'input', placeholder: 'Wofür? (z. B. Pizza)', maxlength: '140' });
  const amount = el('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const currency = el('select', { class: 'input' },
    CURRENCIES.map((c) => el('option', { value: c }, c)));
  const payer = el('select', { class: 'input' },
    members.map((u) => el('option', { value: u.id }, u.id === me?.id ? 'Ich' : u.displayName)));
  if (me) payer.value = me.id;
  const err = el('div', { class: 'formerr' });

  // Split mode toggle: equal across the ticked people, or custom per-person.
  let mode = 'equal';
  const rows = el('div', { class: 'expense-split-rows' });
  const modeBtns = el('div', { class: 'seg', role: 'tablist' }, [
    segBtn('Gleichmäßig', true, () => setMode('equal')),
    segBtn('Eigene Beträge', false, () => setMode('custom')),
  ]);

  function setMode(next) {
    mode = next;
    [...modeBtns.children].forEach((b, i) =>
      b.classList.toggle('on', (i === 0) === (next === 'equal')));
    renderRows();
  }

  function renderRows() {
    clear(rows);
    for (const u of members) {
      const isMe = u.id === me?.id;
      if (mode === 'equal') {
        const box = el('input', { type: 'checkbox', class: 'expense-check' });
        box.checked = true;
        box.dataset.uid = u.id;
        rows.append(el('label', { class: 'expense-row' }, [
          box,
          el('span', { class: 'expense-row-name', text: isMe ? 'Ich' : u.displayName }),
        ]));
      } else {
        const inp = el('input', { class: 'input expense-amt', type: 'text', inputmode: 'decimal',
          placeholder: '0,00' });
        inp.dataset.uid = u.id;
        rows.append(el('label', { class: 'expense-row' }, [
          el('span', { class: 'expense-row-name', text: isMe ? 'Ich' : u.displayName }),
          inp,
        ]));
      }
    }
  }
  renderRows();

  const m = modal({
    title: 'Ausgabe teilen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'expense-grid' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Betrag' }), amount]),
        el('div', { class: 'field' }, [el('label', { text: 'Währung' }), currency]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Bezahlt von' }), payer]),
      el('label', { class: 'hint', text: 'Aufteilen auf' }),
      modeBtns,
      rows,
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Ausgabe hinzufügen')],
  });
  setTimeout(() => title.focus(), 50);

  async function create() {
    err.textContent = '';
    const t = title.value.trim();
    const cents = parseCents(amount.value);
    if (!t) { err.textContent = 'Bitte gib der Ausgabe einen Titel.'; return; }
    if (!Number.isFinite(cents) || cents <= 0) { err.textContent = 'Bitte gib einen gültigen Betrag ein.'; return; }

    const payload = { title: t, amountCents: cents, currency: currency.value, payerId: payer.value, split: mode };
    if (mode === 'equal') {
      payload.participants = [...rows.querySelectorAll('.expense-check')]
        .filter((c) => c.checked).map((c) => c.dataset.uid);
      if (!payload.participants.length) { err.textContent = 'Wähle mindestens eine Person.'; return; }
    } else {
      const shares = [...rows.querySelectorAll('.expense-amt')]
        .map((i) => ({ userId: i.dataset.uid, shareCents: parseCents(i.value) || 0 }))
        .filter((s) => s.shareCents > 0);
      const sum = shares.reduce((a, s) => a + s.shareCents, 0);
      if (sum !== cents) {
        err.textContent = `Die Anteile (${fmtMoney(sum, currency.value)}) ergeben nicht den Betrag (${fmtMoney(cents, currency.value)}).`;
        return;
      }
      payload.shares = shares;
    }
    try {
      await api.post(`/chats/${chatId}/expenses`, payload);
      telemetry.track('expense_create', { split: mode, currency: currency.value });
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte die Ausgabe nicht hinzufügen.'; }
  }
}

function segBtn(label, on, onClick) {
  return el('button', { class: `seg-btn ${on ? 'on' : ''}`, type: 'button', onClick }, label);
}

/** Render the in-chat expense (or settlement) card for message [m]. */
export function renderExpense(m) {
  const ex = m.expense || {};
  const me = store.state.me?.id;
  if (ex.kind === 'settlement') {
    const to = ex.shares?.[0];
    const card = el('div', { class: 'expense-card settlement' });
    card.append(el('div', { class: 'expense-settle' }, [
      el('span', { class: 'expense-emoji', 'aria-hidden': 'true', text: '💸' }),
      el('span', { text: `${ex.payerId === me ? 'Du hast' : (ex.payerName || 'Jemand') + ' hat'} ` +
        `${to ? (to.userId === me ? 'dir' : to.name) : 'jemandem'} ${fmtMoney(ex.amountCents, ex.currency)} ausgeglichen` }),
    ]));
    card.append(ledgerLink(m.chatId || store.state.activeId));
    return card;
  }

  const card = el('div', { class: 'expense-card' });
  card.append(el('div', { class: 'expense-head' }, [
    el('div', { class: 'expense-icon', 'aria-hidden': 'true' }, icon('wallet')),
    el('div', { class: 'expense-meta' }, [
      el('div', { class: 'expense-title', text: ex.title || 'Ausgabe' }),
      el('div', { class: 'expense-sub', text:
        `${ex.payerId === me ? 'Du hast' : (ex.payerName || 'Jemand') + ' hat'} bezahlt` }),
    ]),
    el('div', { class: 'expense-amount', text: fmtMoney(ex.amountCents, ex.currency) }),
  ]));

  // The viewer's own stake: what they owe, or what they're owed back.
  const myShare = ex.myShare || 0;
  let line = '';
  if (ex.iPaid) {
    const owedBack = (ex.amountCents || 0) - myShare;
    line = owedBack > 0 ? `Dir stehen ${fmtMoney(owedBack, ex.currency)} zu` : 'Nur für dich';
  } else if (myShare > 0) {
    line = `Du schuldest ${fmtMoney(myShare, ex.currency)}`;
  } else {
    line = 'Du bist nicht beteiligt';
  }
  card.append(el('div', { class: `expense-you ${ex.iPaid ? 'pos' : (myShare > 0 ? 'neg' : '')}`, text: line }));

  // Per-person share chips (compact).
  const chips = el('div', { class: 'expense-shares' });
  for (const sh of ex.shares || []) {
    chips.append(el('span', { class: 'expense-chip',
      text: `${sh.userId === me ? 'Ich' : sh.name}: ${fmtMoney(sh.shareCents, ex.currency)}` }));
  }
  if ((ex.shares || []).length) card.append(chips);
  card.append(ledgerLink(m.chatId || store.state.activeId));
  return card;
}

function ledgerLink(chatId) {
  return el('button', { class: 'expense-ledger-link', onClick: () => openLedger(chatId) }, [
    icon('wallet', 'sm'), el('span', { text: 'Kasse ansehen' }),
  ]);
}

/** Modal: the per-chat ledger — net balances + minimal settle-up transfers. */
export async function openLedger(chatId) {
  const me = store.state.me?.id;
  const body = el('div', { class: 'ledger' }, el('div', { class: 'pane-empty', text: 'Lade …' }));
  const m = modal({ title: 'Geteilte Kasse', body: (b) => b.append(body) });

  async function refresh() {
    let ledger = [];
    try { ({ ledger } = await api.get(`/chats/${chatId}/ledger`)); }
    catch { clear(body).append(el('div', { class: 'pane-empty', text: 'Konnte die Kasse nicht laden.' })); return; }
    clear(body);
    if (!ledger.length) {
      body.append(el('div', { class: 'pane-empty', text: 'Noch keine Ausgaben. Alles im Lot. 🎉' }));
      return;
    }
    for (const g of ledger) {
      body.append(el('div', { class: 'ledger-cur' }, [
        el('span', { text: g.currency }),
        el('span', { class: 'muted', text: `gesamt ${fmtMoney(g.totalSpent, g.currency)}` }),
      ]));
      for (const bal of g.balances) {
        const cls = bal.net > 0 ? 'pos' : bal.net < 0 ? 'neg' : 'zero';
        const word = bal.net > 0 ? 'bekommt' : bal.net < 0 ? 'schuldet' : 'ausgeglichen';
        body.append(el('div', { class: `ledger-row ${cls}` }, [
          el('span', { class: 'ledger-name', text: bal.userId === me ? 'Ich' : bal.name }),
          el('span', { class: 'ledger-net', text: bal.net === 0 ? word : `${word} ${fmtMoney(Math.abs(bal.net), g.currency)}` }),
        ]));
      }
      if (g.settlements.length) {
        body.append(el('div', { class: 'ledger-sub', text: 'Ausgleichsvorschläge' }));
        for (const t of g.settlements) {
          const mine = t.from === me;
          const row = el('div', { class: 'ledger-settle-row' }, [
            el('span', { text: `${mine ? 'Du' : t.fromName} → ${t.to === me ? 'dir' : t.toName}: ${fmtMoney(t.amount, g.currency)}` }),
          ]);
          if (mine) {
            row.append(el('button', { class: 'btn sm primary',
              onClick: () => settle(chatId, t.to, t.amount, g.currency, refresh) }, 'Begleichen'));
          }
          body.append(row);
        }
      }
    }
  }
  refresh();
}

async function settle(chatId, toUserId, amountCents, currency, after) {
  try {
    await api.post(`/chats/${chatId}/ledger/settle`, { toUserId, amountCents, currency });
    telemetry.track('expense_settle', { currency });
    toast('Ausgleich verbucht.', 'ok');
    if (after) after();
  } catch (e) { toast(e.message || 'Ausgleich fehlgeschlagen.', 'err'); }
}

// ---- Cross-chat "Kasse" pane ----------------------------------------------

export async function renderKassePane(head, body, openChat) {
  clear(head).append(
    el('div', { class: 'pane-title', text: 'Kasse' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Aktualisieren', 'aria-label': 'Aktualisieren',
        onClick: () => paint(body, openChat) }, icon('refresh')),
    ]),
  );
  paint(body, openChat);
  store.on('messages', () => { if (document.body.contains(body)) paint(body, openChat); });
}

async function paint(body, openChat) {
  clear(body);
  const scroll = el('div', { class: 'pane-scroll' });
  body.appendChild(scroll);
  for (let i = 0; i < 3; i++) scroll.appendChild(el('div', { class: 'agenda-skel' }));

  let entries = [];
  try { ({ entries } = await api.get('/me/ledger')); }
  catch { clear(scroll); scroll.append(el('div', { class: 'pane-empty', text: 'Kasse konnte nicht geladen werden.' })); return; }

  clear(scroll);
  if (!entries.length) {
    scroll.append(el('div', { class: 'pane-empty',
      text: 'Alles ausgeglichen. Teile eine Ausgabe über das 📎-Menü in einem Chat.' }));
    return;
  }
  for (const e of entries) {
    const pos = e.net > 0;
    scroll.append(el('button', { class: 'agenda-row', onClick: () => openChat(e.chatId) }, [
      el('div', { class: `agenda-dot ${pos ? 'going' : 'declined'}`, 'aria-hidden': 'true' }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: e.chatTitle || 'Chat' }),
        el('div', { class: 'uabout', text: pos ? 'Du bekommst Geld' : 'Du schuldest' }),
      ]),
      el('div', { class: 'agenda-side' }, [
        el('span', { class: `ledger-net ${pos ? 'pos' : 'neg'}`, text: fmtMoney(Math.abs(e.net), e.currency) }),
      ]),
    ]));
  }
}
