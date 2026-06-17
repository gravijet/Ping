/* native.js — the web side of the Windows desktop bridge. When Ping Web runs
   inside the WebView2 shell (app/lib/screens/windows_web_shell.dart), the shell
   exposes window.chrome.webview. We post small JSON messages out (unread count,
   notifications) and react to messages in (open a chat, lock, focus). In a plain
   browser none of this exists, so every call is a safe no-op. */

const webview = (typeof window !== 'undefined' && window.chrome && window.chrome.webview) || null;
const handlers = new Map();

export function isShell() { return !!webview; }

function post(msg) {
  if (!webview) return;
  try { webview.postMessage(JSON.stringify(msg)); } catch { /* ignore */ }
}

// Reflect the total unread count on the taskbar icon (overlay badge).
export function setUnread(count) { post({ type: 'unread', count: Math.max(0, count | 0) }); }

// Ask the shell to raise a native OS notification (it owns the tray + toast).
export function nativeNotify({ title, body, chatId }) {
  post({ type: 'notify', title: title || 'Ping', body: body || '', chatId: chatId || '' });
}

// Windows-only preferences the host owns (no-ops in a browser).
export function setAutostart(on) { post({ type: 'autostart', on: !!on }); }
export function setCloseToTray(on) { post({ type: 'closeToTray', on: !!on }); }

export function onNative(type, fn) { handlers.set(type, fn); }

if (webview) {
  webview.addEventListener('message', (e) => {
    let data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
    if (data && data.type && handlers.has(data.type)) {
      try { handlers.get(data.type)(data); } catch (err) { console.error(err); }
    }
  });
  // Let the shell know the web app is ready to receive messages.
  post({ type: 'ready' });
  document.documentElement.setAttribute('data-shell', 'windows');

  // Open external links in the user's default browser instead of navigating the
  // shell away from the app (or having the popup silently blocked).
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
      e.preventDefault();
      post({ type: 'open-url', url: href });
    }
  }, true);
}
