/* webhooks.js — incoming webhooks / bots for a group (0.34.0). Create a webhook to
   get a one-time URL an external service can POST to (it fans a message into the
   chat). List + revoke existing ones. The plaintext token is shown exactly once. */

import { api } from './api.js';
import { el, clear, icon, modal, toast, confirmModal } from './ui.js';

export function openWebhooks(chatId) {
  const list = el('div', { class: 'wh-list' });
  modal({
    title: 'Webhooks & Bots',
    width: '480px',
    body: (b) => b.append(
      el('p', { class: 'hint', text: 'Ein eingehender Webhook gibt dir eine URL, an die ein externer Dienst POSTen kann — die Nachricht landet dann hier im Chat.' }),
      list,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, [icon('plus'), 'Neuer Webhook'])],
  });
  paint();
  async function paint() {
    clear(list).append(el('div', { class: 'hint', text: 'Lade …' }));
    let webhooks = [];
    try { ({ webhooks } = await api.get(`/chats/${chatId}/webhooks`)); } catch { /* offline */ }
    clear(list);
    if (!webhooks?.length) { list.append(el('div', { class: 'pane-empty', text: 'Noch keine Webhooks.' })); return; }
    for (const w of webhooks) {
      list.append(el('div', { class: 'wh-row' }, [
        el('div', { class: 'wh-meta' }, [
          el('div', { class: 'wh-name', text: w.name }),
          el('div', { class: 'wh-sub', text: (w.direction === 'out' ? 'Ausgehend' : 'Eingehend')
            + (w.lastUsedAt ? ' · zuletzt ' + new Date(w.lastUsedAt).toLocaleDateString('de-DE') : '') }),
        ]),
        el('button', { class: 'iconbtn', title: 'Entfernen', onClick: async () => {
          if (!(await confirmModal({ title: 'Webhook entfernen?', message: w.name, confirmText: 'Entfernen', danger: true }))) return;
          try { await api.del(`/chats/${chatId}/webhooks/${w.id}`); paint(); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash')),
      ]));
    }
  }
  async function create() {
    const name = prompt('Name des Webhooks (z. B. „GitHub", „CI"):');
    if (!name?.trim()) return;
    try {
      const { webhook } = await api.post(`/chats/${chatId}/webhooks`, { name: name.trim(), direction: 'in' });
      showToken(webhook);
      paint();
    } catch (e) { toast(e.message || 'Konnte den Webhook nicht anlegen.', 'err'); }
  }
}

function showToken(webhook) {
  const url = `${location.origin}/api/hooks/${webhook.token}`;
  const example = `curl -X POST ${url} -H "Content-Type: application/json" -d '{"text":"Hallo aus dem Bot"}'`;
  modal({
    title: 'Webhook angelegt',
    width: '520px',
    body: (b) => b.append(
      el('p', { class: 'hint', text: 'Diese URL wird nur einmal angezeigt. Bewahre sie sicher auf.' }),
      el('div', { class: 'wh-url' }, [
        el('code', { text: url }),
        el('button', { class: 'btn ghost sm', onClick: () => { navigator.clipboard?.writeText(url); toast('Kopiert.'); } }, [icon('copy'), 'Kopieren']),
      ]),
      el('div', { class: 'ip-section', text: 'Beispiel' }),
      el('pre', { class: 'wh-example', text: example }),
    ),
  });
}
