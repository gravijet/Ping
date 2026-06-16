/* ============================================================================
   Ping — marketing site single-page application.
   One shell (index.html), one script. The server serves the same shell for
   every marketing route (/, /news, /news/:slug, /changelog, /status, /legal);
   this router reads location.pathname and renders the right view *without a
   full reload*, while deep links and the browser back/forward button keep
   working natively. Content comes from the public JSON API.
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------- icons ----
  // A small hand-picked line-icon set (no emoji). Stroked, currentColor.
  const I = {
    bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
    reactions: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
    groups: 'M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5.5 19a3 3 0 0 1 3-5M18.5 19a3 3 0 0 0-3-5',
    palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5c0-3.9-4-6.6-9-6.6ZM7.5 12h.01M10 8h.01M14.5 7.5h.01',
    poll: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
    timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10v4l2 2M9 2h6',
    bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
    lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    menu: 'M4 7h16M4 12h16M4 17h16',
    close: 'M6 6l12 12M18 6 6 18',
    arrowUp: 'M12 19V5M5 12l7-7 7 7',
    arrowRight: 'M5 12h14M13 6l6 6-6 6',
    link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
    share: 'M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M16 6l-4-4-4 4M12 2v13',
    download: 'M12 3v12M7 11l5 5 5-5M5 21h14',
    monitor: 'M3 5h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 21h8M12 17v4',
    check: 'M5 12l5 5 9-11',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z',
    sparkles: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3ZM19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
    eyeOff: 'M9.9 4.2A9.5 9.5 0 0 1 12 4c5 0 9 4.5 10 8a13 13 0 0 1-2.2 3.3M6.5 6.5C3.9 8 2.3 10.3 2 12c1 3.5 5 8 10 8 1.7 0 3.3-.5 4.7-1.3M3 3l18 18M10 10a3 3 0 0 0 4 4',
  };
  const svg = (d, w) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.7}" stroke-linecap="round" stroke-linejoin="round">${
      d.split('M').filter(Boolean).map((p) => `<path d="M${p.trim()}"/>`).join('')
    }</svg>`;
  const LOGO =
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 1-2Z" fill="#fff" opacity=".96"/><circle cx="9" cy="10.5" r="1.4" fill="#1f6bff"/><circle cx="13" cy="10.5" r="1.4" fill="#1f6bff"/><circle cx="17" cy="10.5" r="1.4" fill="#1f6bff"/></svg>';

  // --------------------------------------------------------------- helpers ---
  const P = {
    icon: (name, w) => svg(I[name] || '', w),
    esc: (s) =>
      String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      ),
    human(b) {
      if (b == null) return '—';
      const u = ['B', 'KB', 'MB', 'GB'];
      let i = 0, n = b;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
    },
    count: (n) => new Intl.NumberFormat('de-DE').format(n || 0),
    fmtDate(ms) {
      if (!ms) return '';
      try { return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); }
      catch { return ''; }
    },
    relTime(ms) {
      if (!ms) return '';
      const s = Math.round((Date.now() - ms) / 1000);
      if (s < 60) return 'gerade eben';
      const m = Math.round(s / 60); if (m < 60) return `vor ${m} min`;
      const h = Math.round(m / 60); if (h < 24) return `vor ${h} h`;
      const d = Math.round(h / 24); if (d < 30) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
      return P.fmtDate(ms);
    },
    async json(url) {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    countUp(el, target) {
      const dur = 900, start = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - start) / dur);
        el.textContent = P.count(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    reveal(root) {
      const els = (root || document).querySelectorAll('.reveal:not(.in)');
      if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
      const io = new IntersectionObserver(
        (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );
      els.forEach((el, i) => { el.style.transitionDelay = (i % 5) * 0.05 + 's'; io.observe(el); });
    },
    tag: (t) => ({ feature: 'Neu', improvement: 'Verbessert', fix: 'Behoben', security: 'Sicherheit' }[t] || t || ''),
    // Safe mini-markdown: escape first, then ## heading / - bullet / **bold**.
    richText(src) {
      const inline = (s) => P.esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const lines = String(src || '').split(/\r?\n/);
      let out = '', list = false, para = [];
      const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
      const flushL = () => { if (list) { out += '</ul>'; list = false; } };
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) { flushP(); flushL(); continue; }
        if (/^##\s+/.test(line)) { flushP(); flushL(); out += '<h3>' + inline(line.replace(/^##\s+/, '')) + '</h3>'; }
        else if (/^[-*•]\s+/.test(line)) { flushP(); if (!list) { out += '<ul>'; list = true; } out += '<li>' + inline(line.replace(/^[-*•]\s+/, '')) + '</li>'; }
        else { flushL(); para.push(line); }
      }
      flushP(); flushL();
      return out;
    },
    toast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg; t.classList.add('show');
      clearTimeout(P._tt); P._tt = setTimeout(() => t.classList.remove('show'), 2600);
    },
    async copy(text, label) {
      try { await navigator.clipboard.writeText(text); P.toast(label || 'Kopiert.'); }
      catch { P.toast('Kopieren nicht möglich.'); }
    },
    async share(data) {
      if (navigator.share) { try { await navigator.share(data); return; } catch { /* cancelled */ } }
      P.copy(data.url, 'Link kopiert.');
    },
  };
  window.Ping = P;

  // ----------------------------------------------------------------- theme ---
  const THEME_KEY = 'ping_theme';
  function osPrefersLight() { return matchMedia('(prefers-color-scheme: light)').matches; }
  function effectiveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return osPrefersLight() ? 'light' : 'dark'; // 'system'
  }
  function applyTheme(mode) {
    const eff = effectiveTheme(mode);
    document.documentElement.setAttribute('data-theme', eff);
    const btn = document.getElementById('themeBtn');
    if (btn) { btn.innerHTML = P.icon(eff === 'light' ? 'moon' : 'sun'); btn.title = eff === 'light' ? 'Dunkles Design' : 'Helles Design'; }
  }
  function currentTheme() { return localStorage.getItem(THEME_KEY) || 'system'; }
  function toggleTheme() {
    const next = effectiveTheme(currentTheme()) === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
  }

  // --------------------------------------------------------- shell (chrome) --
  const NAV = [
    { href: '/#features', label: 'Funktionen', key: 'features' },
    { href: '/news', label: 'Newsroom', key: 'news' },
    { href: '/changelog', label: 'Changelog', key: 'changelog' },
    { href: '/status', label: 'Status', key: 'status' },
    { href: '/#faq', label: 'FAQ', key: 'faq' },
  ];
  function renderChrome() {
    document.getElementById('nav').innerHTML =
      `<div class="wrap nav-in">
        <a class="brand" href="/"><span class="logo">${LOGO}</span>Ping</a>
        <div class="nav-links" id="navLinks">
          ${NAV.map((n) => `<a class="lnk" data-key="${n.key}" href="${n.href}">${n.label}</a>`).join('')}
        </div>
        <div class="nav-right">
          <button class="icon-btn" id="themeBtn" aria-label="Design wechseln"></button>
          <a class="btn sm ghost" href="https://example.invalid">${P.icon('monitor')}<span>Web</span></a>
          <a class="btn sm" href="/download">${P.icon('download')}<span>Laden</span></a>
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menü">${P.icon('menu')}</button>
        </div>
      </div>`;
    document.getElementById('themeBtn').onclick = toggleTheme;
    const links = document.getElementById('navLinks');
    document.getElementById('menuBtn').onclick = () => {
      const open = links.classList.toggle('open');
      document.getElementById('menuBtn').innerHTML = P.icon(open ? 'close' : 'menu');
    };
    addEventListener('scroll', () => document.getElementById('nav').classList.toggle('scrolled', scrollY > 8), { passive: true });

    document.getElementById('footer').innerHTML =
      `<div class="wrap">
        <div class="foot-grid">
          <div>
            <a class="brand" href="/"><span class="logo">${LOGO}</span>Ping</a>
            <p class="blurb">Der schnelle, werbefreie Messenger. Echtzeit-Chats, Gruppen, Status & mehr — privat by default.</p>
            <p class="blurb mono">⌁ Made in Austria</p>
          </div>
          <div><h4>Produkt</h4>
            <a href="/#features">Funktionen</a><a href="/download">Download</a>
            <a href="/status">System-Status</a><a href="/#how">Installation</a></div>
          <div><h4>Ressourcen</h4>
            <a href="/news">Newsroom</a><a href="/changelog">Changelog</a>
            <a href="/#faq">Häufige Fragen</a><a href="/#how">So funktioniert's</a></div>
          <div><h4>Rechtliches</h4>
            <a href="/legal#impressum">Impressum</a><a href="/legal#datenschutz">Datenschutz</a>
            <a href="mailto:user@example.invalid">Kontakt</a></div>
        </div>
        <div class="foot-bottom">
          <div>© ${new Date().getFullYear()} Ping · Messenger</div>
          <div><span id="footState">prüfe …</span> · example.invalid</div>
        </div>
      </div>`;
    fetch('/health').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const s = document.getElementById('footState');
      if (s) s.textContent = d && d.ok ? '● alle Systeme online' : '● eingeschränkt';
    }).catch(() => { const s = document.getElementById('footState'); if (s) s.textContent = '● Status unbekannt'; });
  }
  function setActiveNav(key) {
    document.querySelectorAll('#navLinks .lnk').forEach((a) => a.classList.toggle('active', a.dataset.key === key));
  }

  // ---------------------------------------------------------------- router ---
  const view = () => document.getElementById('view');
  let cleanup = null;
  const SPA = [
    { re: /^\/$/, name: 'home', nav: '' , render: renderHome },
    { re: /^\/news\/([^/]+)\/?$/, name: 'article', nav: 'news', render: (m) => renderArticle(decodeURIComponent(m[1])) },
    { re: /^\/news\/?$/, name: 'news', nav: 'news', render: renderNews },
    { re: /^\/changelog\/?$/, name: 'changelog', nav: 'changelog', render: renderChangelog },
    { re: /^\/status\/?$/, name: 'status', nav: 'status', render: renderStatus },
    { re: /^\/legal\/?$/, name: 'legal', nav: '', render: renderLegal },
  ];
  function match(pathname) {
    for (const r of SPA) { const m = pathname.match(r.re); if (m) return { route: r, m }; }
    return null;
  }

  async function route(scrollHash) {
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    const found = match(location.pathname);
    if (!found) { location.reload(); return; }
    setActiveNav(found.route.nav);
    document.body.classList.add('is-loading');
    try {
      cleanup = (await found.route.render(found.m)) || null;
    } catch (e) {
      view().innerHTML = `<div class="wrap"><div class="empty"><span class="em">⚠</span>Inhalt konnte nicht geladen werden.<br><a class="btn sm" style="margin-top:14px" href="/">Zur Startseite</a></div></div>`;
    }
    document.body.classList.remove('is-loading');
    P.reveal();
    if (scrollHash) scrollToHash(scrollHash);
    else window.scrollTo(0, 0);
  }
  function scrollToHash(hash) {
    const el = document.getElementById(hash.replace('#', ''));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    else window.scrollTo({ top: 0 });
  }

  function navigate(href, opts = {}) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) { location.assign(href); return; }
    closeMenu();
    // Already on this path: jump to the anchor, or scroll up — never re-render.
    if (url.pathname === location.pathname) {
      if (url.hash) { history.pushState({}, '', url.pathname + url.hash); scrollToHash(url.hash); }
      else window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!match(url.pathname)) { location.assign(href); return; } // native (e.g. /download)
    history[opts.replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
    route(url.hash || null);
  }
  function currentNavKey() { const f = match(location.pathname); return f ? f.route.nav : ''; }
  function closeMenu() {
    const links = document.getElementById('navLinks');
    if (links && links.classList.contains('open')) { links.classList.remove('open'); document.getElementById('menuBtn').innerHTML = P.icon('menu'); }
  }

  // Intercept eligible internal link clicks for SPA navigation.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || a.target === '_blank' || a.hasAttribute('download') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    // Let the browser handle non-SPA paths (downloads, api, admin, health).
    const samePathHash = url.pathname === location.pathname && url.hash;
    if (!match(url.pathname) && !samePathHash) return;
    e.preventDefault();
    navigate(href);
  });
  addEventListener('popstate', () => route(location.hash || null));

  // ============================================================ VIEWS ========

  // ---- HOME ----
  function renderHome() {
    setActiveNav('');
    view().innerHTML = `
    <div class="wrap">
      <section class="hero">
        <div>
          <div class="status-line"><span class="led" id="heroLed"></span><span id="heroState">Alle Systeme online</span></div>
          <h1 class="display reveal in">Messaging,<br>das dir <span class="accent-text">gehört.</span></h1>
          <p class="lead reveal in">Ping ist ein moderner Messenger für Android, Windows und den Browser:
            Einzel- und Gruppenchats in Echtzeit, Status, Sprachnachrichten und mehr.
            Werbefrei, ohne Tracking und mit so wenig gespeicherten Daten wie möglich.</p>
          <div class="cta reveal in">
            <a class="btn big" href="/download">${P.icon('download')}Für Android laden</a>
            <a class="btn ghost big" href="https://example.invalid">${P.icon('monitor')}Im Browser öffnen</a>
            <a class="btn ghost big" href="/#features">Funktionen ansehen ${P.icon('arrowRight')}</a>
          </div>
          <div class="specs reveal in">
            <div class="spec"><span class="v" id="specVer">v…</span><span class="k">Aktuelle Version</span></div>
            <div class="spec"><span class="v" id="specSize">…</span><span class="k">Download-Größe</span></div>
            <div class="spec"><span class="v">Android 6+</span><span class="k">Voraussetzung</span></div>
          </div>
        </div>
        <div class="device-stage reveal in">
          <div class="device"><div class="notch"></div><div class="screen">
            <div class="dev-bar"><div class="av">M</div><div><div class="nm">Mia &amp; Team</div><div class="pr">3 online · tippt …</div></div></div>
            <div class="dev-feed">
              <div class="bub in">Bist du schon auf Ping? ⌁</div>
              <div class="bub out">Klar — schon installiert.</div>
              <div class="bub in">Mega schnell hier!<span class="react">♥ 3</span></div>
              <div class="bub out">Und sieht richtig gut aus.</div>
              <div class="bub in">Schick mal deinen Status →</div>
            </div>
          </div></div>
        </div>
      </section>

      <div class="stat-band reveal" id="statBand">
        <div class="cell"><div class="n" data-stat="users">–</div><div class="k">Nutzer</div></div>
        <div class="cell"><div class="n" data-stat="messages">–</div><div class="k">Nachrichten</div></div>
        <div class="cell"><div class="n" data-stat="online">–</div><div class="k">Gerade online</div></div>
        <div class="cell"><div class="n">0 €</div><div class="k">Für immer kostenlos</div></div>
      </div>
      <div class="trust reveal">
        ${[['bolt', 'Nachrichten in Echtzeit'], ['bell', 'Push-Benachrichtigungen'], ['palette', 'Viele Designs'], ['lock', 'Datensparsam'], ['shield', 'Werbefrei']]
          .map(([ic, t]) => `<span class="chip">${P.icon(ic)}${t}</span>`).join('')}
      </div>

      <section class="section" id="features">
        <div class="section-head reveal">
          <span class="kicker"><span class="idx">01</span> Funktionen</span>
          <h2 class="h2">Alles, was guter Messenger braucht.</h2>
          <p class="lead">Vom ersten „Hallo“ bis zur Gruppenplanung: Ping bringt die Funktionen mit, die du täglich nutzt — übersichtlich und ohne Ballast.</p>
        </div>
        <div class="feat-grid reveal">
          ${[
            ['bolt', 'Echtzeit & zuverlässig', 'Nachrichten, Tipp-Anzeige und Lesebestätigungen live — ohne spürbare Verzögerung.'],
            ['reactions', 'Reaktionen & Antworten', 'Reagiere mit Emojis, zitiere Nachrichten und sende Sprachnachrichten.'],
            ['groups', 'Gruppen & Status', 'Gruppenchats mit Admin-Rechten und 24-Stunden-Status mit Foto & Video.'],
            ['palette', 'Themes & Sticker', '14+ Designs, eigene Chat-Hintergründe und selbstgezeichnete Sticker.'],
            ['poll', 'Umfragen & Polls', 'Frag deine Gruppe — Einfach- oder Mehrfachauswahl mit Live-Ergebnissen.'],
            ['timer', 'Selbstlöschende Chats', 'Verschwindende Nachrichten mit Timer — für alles, was nicht bleiben soll.'],
            ['bell', 'Push & offline', 'Verpasse nichts dank Push-Benachrichtigungen, auch wenn die App zu ist.'],
            ['refresh', 'Auto-Updates', 'Neue Versionen meldet die App selbst und installiert sie mit einem Tipp.'],
            ['eyeOff', 'Privat by default', 'Gefunden wirst du nur über deine Nummer. Dein Adressbuch bleibt lokal.'],
          ].map(([ic, t, d]) => `<div class="feat"><div class="ic">${P.icon(ic)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>

      <section class="section" id="principles">
        <div class="section-head reveal">
          <span class="kicker"><span class="idx">02</span> Haltung</span>
          <h2 class="h2">Worauf es uns ankommt.</h2>
          <p class="lead">Ping ist ein unabhängiges Projekt aus Österreich. Diese Grundsätze stehen über jeder einzelnen Funktion.</p>
        </div>
        <div class="principles reveal">
          ${[
            ['lock', 'Datensparsam', 'Wir verarbeiten nur, was der Dienst wirklich braucht. Dein Adressbuch bleibt auf deinem Gerät, gefunden wirst du ausschließlich über deine Telefonnummer.'],
            ['shield', 'Werbe- & trackingfrei', 'Keine Werbung, keine Werbe-Tracker, kein Verkauf deiner Daten an Dritte. Ping finanziert sich nicht über deine Aufmerksamkeit.'],
            ['sparkles', 'Offen & ehrlich', 'Wir sagen klar, welche Daten wofür anfallen. Was sich ändert, steht im Changelog — keine versteckten Funktionen, keine Überraschungen.'],
          ].map(([ic, t, d]) => `<div class="principle"><div class="ic">${P.icon(ic)}</div><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}
        </div>
      </section>

      <section class="section" id="how">
        <div class="section-head reveal">
          <span class="kicker"><span class="idx">03</span> Installation</span>
          <h2 class="h2">In einer Minute startklar.</h2>
          <p class="lead">Ping kommt direkt von hier — du brauchst kein zusätzliches Konto bei einem App-Store und keine Wartezeit auf Freigaben.</p>
        </div>
        <div class="steps reveal">
          <div class="step"><div class="num">01</div><h4>Herunterladen</h4><p>Tippe auf „Für Android laden“. Die Installationsdatei kommt direkt und immer aktuell von uns.</p></div>
          <div class="step"><div class="num">02</div><h4>Installation bestätigen</h4><p>Dein Gerät fragt einmalig nach der Erlaubnis zur Installation — kurz bestätigen, fertig.</p></div>
          <div class="step"><div class="num">03</div><h4>Loslegen</h4><p>Öffne Ping, melde dich mit deiner Handynummer an und schreib deiner ersten Person.</p></div>
        </div>
      </section>

      <section class="section" id="download">
        <div class="section-head reveal"><span class="kicker"><span class="idx">04</span> Download</span>
          <h2 class="h2">Hol dir Ping.</h2>
          <p class="lead">Für Android, Windows und den Browser. Kostenlos, werbefrei und ohne Konto-Zwang — die passende Version wählen wir automatisch für dich.</p></div>
        <div class="dl-card reveal">
          <div class="dl-top">
            <div>
              <h2 id="dlTitle">Ping für Android</h2>
              <p class="lead" style="margin-bottom:22px">Am Handy? Tippe auf „Herunterladen“ und folge der kurzen Anleitung. Am Computer? Öffne diese Seite einfach auf deinem Handy.</p>
              <a class="btn big" href="/download">${P.icon('download')}Herunterladen</a>
              <div class="dl-assure">${[['shield', 'Auf Schadsoftware geprüft'], ['lock', 'Ohne Konto-Zwang'], ['refresh', 'Updates direkt in der App']]
                .map(([ic, t]) => `<span>${P.icon(ic)}${t}</span>`).join('')}</div>
            </div>
            <div class="dl-meta" id="dlMeta">
              <div class="kv"><span>Aktuelle Version</span><b id="dlVer">…</b></div>
              <div class="kv"><span>Download-Größe</span><b id="dlSize">…</b></div>
              <div class="kv"><span>Voraussetzung</span><b>Android 6 +</b></div>
              <div class="kv"><span>Preis</span><b>Kostenlos</b></div>
            </div>
          </div>
        </div>
        <div class="dl-card reveal" id="dlWindows" style="display:none">
          <div class="dl-top">
            <div>
              <h2>Ping für Windows</h2>
              <p class="lead" style="margin-bottom:22px">Wie WhatsApp Desktop: Installier Ping auf deinem PC und melde dich per QR-Code an — ganz ohne Passwort.</p>
              <a class="btn big" href="/download/windows">${P.icon('download')}Für Windows laden</a>
              <ol class="dl-steps">
                <li><b>Installieren</b> — lade die Datei und folge dem Setup.</li>
                <li><b>Am Handy verknüpfen</b> — Ping öffnen → Einstellungen → „Ping für Windows“.</li>
                <li><b>QR-Code scannen</b> — den am PC gezeigten Code abscannen, fertig.</li>
              </ol>
              <div class="dl-assure">${[['shield', 'Auf Viren geprüft'], ['lock', 'Anmeldung per QR'], ['refresh', 'Synchron mit dem Handy']]
                .map(([ic, t]) => `<span>${P.icon(ic)}${t}</span>`).join('')}</div>
            </div>
            <div class="dl-meta">
              <div class="kv"><span>Aktuelle Version</span><b id="dlWinVer">…</b></div>
              <div class="kv"><span>Download-Größe</span><b id="dlWinSize">…</b></div>
              <div class="kv"><span>Voraussetzung</span><b>Windows 10 +</b></div>
              <div class="kv"><span>Anmeldung</span><b>QR-Code</b></div>
            </div>
          </div>
        </div>
      </section>

      <section class="section" id="newsroom">
        <div class="teaser-head">
          <div><span class="kicker reveal"><span class="idx">05</span> Newsroom</span><h2 class="h2 reveal" style="margin-top:12px">Frisch aus dem Team</h2></div>
          <a class="more-link reveal" href="/news">Alle Neuigkeiten →</a>
        </div>
        <div class="tgrid" id="newsTeaser">${skel('tcard', 3, 160)}</div>
      </section>

      <section class="section" id="changelog-teaser">
        <div class="teaser-head">
          <div><span class="kicker reveal"><span class="idx">06</span> Changelog</span><h2 class="h2 reveal" style="margin-top:12px">Zuletzt verbessert</h2></div>
          <a class="more-link reveal" href="/changelog">Vollständiger Changelog →</a>
        </div>
        <div class="card reveal" id="logTeaser" style="padding:6px 24px">${skel('', 3, 56)}</div>
      </section>

      <section class="section" id="faq">
        <div class="section-head reveal"><span class="kicker"><span class="idx">07</span> FAQ</span>
          <h2 class="h2">Häufige Fragen</h2><p class="lead">Das Wichtigste auf einen Blick. Findest du deine Frage nicht, schreib uns einfach.</p></div>
        <div class="faq reveal">
          ${[
            ['Was kostet Ping?', 'Nichts. Ping ist kostenlos, werbefrei und ohne versteckte Käufe. Es ist ein privates Projekt, kein kommerzieller Dienst.'],
            ['Wie geht Ping mit meinen Daten um?', 'So sparsam wie möglich. Wir speichern nur, was für den Betrieb nötig ist. Gefunden wirst du ausschließlich über deine Telefonnummer — nie über eine Namens- oder E-Mail-Suche. Dein Adressbuch bleibt auf deinem Gerät. Details findest du in der <a href="/legal#datenschutz">Datenschutzerklärung</a>.'],
            ['Auf welchen Geräten läuft Ping?', 'Auf Android (Version 6.0 oder neuer), auf Windows (10 und neuer) sowie im Browser. Deine Chats bleiben auf allen Geräten synchron.'],
            ['Bekomme ich automatisch Updates?', 'Ja. Sobald eine neue Version verfügbar ist, weist dich die App darauf hin und installiert sie auf Wunsch mit einem Tipp.'],
            ['Warum lädt man Ping direkt hier und nicht im App-Store?', 'So bekommst du Updates ohne Umweg direkt von uns und Ping bleibt frei von Plattform-Gebühren. Die Installationsdatei wird vor jeder Veröffentlichung auf Schadsoftware geprüft.'],
            ['Wie melde ich mich am Computer an?', 'Installiere Ping für Windows oder öffne die Web-Version, öffne die Handy-App unter Einstellungen → „Ping für Windows/Web“ und scanne den angezeigten QR-Code. Dein Konto ist sofort verbunden — ganz ohne zusätzliches Passwort.'],
            ['Kann ich mein Konto und meine Daten löschen?', 'Jederzeit. In der App kannst du dein Konto mit allen Daten selbst löschen und deine Inhalte vorher exportieren. Status-Updates verschwinden ohnehin automatisch nach 24 Stunden.'],
            ['Wer steckt hinter Ping?', 'Ping wird privat von Benjamin Berger in Österreich entwickelt und betrieben. Kontakt: <a href="mailto:user@example.invalid">user@example.invalid</a>.'],
          ].map(([q, a]) => `<details><summary>${q}</summary><div class="ans">${a}</div></details>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="card reveal" style="text-align:center;padding:clamp(36px,6vw,60px)">
          <h2 class="h2" style="margin-bottom:12px">Bereit für bessere Chats?</h2>
          <p class="lead" style="max-width:46ch;margin:0 auto 26px">Lad dir Ping und hol deine Leute dazu. Kostenlos, werbefrei, sofort einsatzbereit.</p>
          <a class="btn big" href="/download">${P.icon('download')}Jetzt herunterladen</a>
        </div>
      </section>
    </div>`;
    document.title = 'Ping · Schneller, moderner Messenger';

    // Dynamic data.
    loadBuild();
    loadStats();
    loadTeasers();
    // Live server health in the hero status line — keeps the claim honest.
    fetch('/health').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const led = document.getElementById('heroLed'), st = document.getElementById('heroState');
      const ok = !!(d && d.ok);
      if (led) led.style.background = ok ? '' : 'var(--warn, #f5a623)';
      if (st) st.textContent = ok ? 'Alle Systeme online' : 'Eingeschränkter Betrieb';
    }).catch(() => { const st = document.getElementById('heroState'); if (st) st.textContent = 'Status wird geprüft …'; });
    // If we arrived on /#hash, scroll there.
    if (location.hash) scrollToHash(location.hash);
  }

  function skel(cls, n, h) {
    let out = '';
    for (let i = 0; i < n; i++) out += `<div class="${cls} skeleton" style="height:${h}px;border-radius:14px"></div>`;
    return out;
  }

  function loadBuild() {
    fetch('/download/info').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('specVer', 'v' + d.version); set('specSize', P.human(d.size));
      set('dlVer', 'v' + d.version); set('dlSize', P.human(d.size));
      // Reveal the Windows card only once a desktop build is published
      // (WINDOWS_DOWNLOAD_URL is set on the server).
      const win = document.getElementById('dlWindows');
      if (win && d.windows && d.windows.url) {
        win.style.display = '';
        set('dlWinVer', d.windows.version ? 'v' + d.windows.version : '—');
        set('dlWinSize', d.windows.size ? P.human(d.windows.size) : '—');
      }
    }).catch(() => {});
  }
  function loadStats() {
    fetch('/api/public/stats').then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s) return;
      const band = document.getElementById('statBand');
      if (!band) return;
      const run = () => band.querySelectorAll('[data-stat]').forEach((el) => P.countUp(el, s[el.dataset.stat] || 0));
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } }), { threshold: 0.3 });
        io.observe(band);
      } else run();
    }).catch(() => {});
  }
  function loadTeasers() {
    P.json('/api/news?limit=3').then((d) => {
      const el = document.getElementById('newsTeaser'); const posts = (d && d.posts) || [];
      if (!el) return;
      if (!posts.length) { const s = document.getElementById('newsroom'); if (s) s.style.display = 'none'; return; }
      el.innerHTML = posts.map((p) => `<a class="tcard" href="/news/${P.esc(p.slug)}">
        ${p.category ? `<span class="pill news" style="align-self:flex-start">${P.esc(p.category)}</span>` : ''}
        <h4>${P.esc(p.title)}</h4><p>${P.esc(p.summary || '')}</p>
        <div class="meta">${P.fmtDate(p.publishedAt || p.createdAt)}</div></a>`).join('');
      P.reveal(el);
    }).catch(() => { const s = document.getElementById('newsroom'); if (s) s.style.display = 'none'; });

    P.json('/api/changelog?limit=3').then((d) => {
      const el = document.getElementById('logTeaser'); const posts = (d && d.posts) || [];
      if (!el) return;
      if (!posts.length) { const s = document.getElementById('changelog-teaser'); if (s) s.style.display = 'none'; return; }
      el.innerHTML = posts.map((p) => `<a class="log-row" href="/changelog" style="color:inherit">
        <div class="v">${p.version ? 'v' + P.esc(p.version) : '—'}</div>
        <div class="body"><b>${P.esc(p.title)}</b> ${p.tag ? `<span class="pill ${P.esc(p.tag)}">${P.esc(P.tag(p.tag))}</span>` : ''}
        <p>${P.esc(p.summary || '')}</p></div></a>`).join('');
    }).catch(() => { const s = document.getElementById('changelog-teaser'); if (s) s.style.display = 'none'; });
  }

  // ---- NEWSROOM ----
  async function renderNews() {
    document.title = 'Newsroom · Ping';
    view().innerHTML = `<div class="wrap">
      <div class="page-head reveal"><span class="kicker">Newsroom</span>
        <h1 class="h1">Neuigkeiten von Ping</h1>
        <p>Produkt-Updates, Ankündigungen und Geschichten — direkt vom Team.</p></div>
      <div class="toolbar reveal">
        <label class="search">${P.icon('search')}<input id="newsSearch" placeholder="Newsroom durchsuchen …" autocomplete="off"><kbd>/</kbd></label>
        <div class="filters" id="newsFilters"></div>
      </div>
      <div class="news-grid" id="newsList">${skel('post-card', 3, 300)}</div>
    </div>`;
    let posts = [];
    try { posts = (await P.json('/api/news')).posts || []; }
    catch { document.getElementById('newsList').outerHTML = emptyBox('Newsroom gerade nicht erreichbar.'); return; }
    const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))];
    let activeCat = '', query = '';
    const filters = document.getElementById('newsFilters');
    filters.innerHTML = `<button class="active" data-c="">Alle</button>` + cats.map((c) => `<button data-c="${P.esc(c)}">${P.esc(c)}</button>`).join('');
    const card = (p, feature) => `<a class="post-card ${feature ? 'feature' : ''}" href="/news/${P.esc(p.slug)}">
      <div class="cover" ${p.cover ? `style="background-image:linear-gradient(rgba(7,9,14,.1),rgba(7,9,14,.4)),url('${P.esc(p.cover)}')"` : ''}>${p.category ? `<span class="pill news cat">${P.esc(p.category)}</span>` : ''}</div>
      <div class="body"><h3>${P.esc(p.title)}</h3><p>${P.esc(p.summary || '')}</p>
        <div class="meta">${P.esc(p.author || 'Ping Team')} · ${P.fmtDate(p.publishedAt || p.createdAt)}</div></div></a>`;
    const list = document.getElementById('newsList');
    function draw() {
      let f = posts.filter((p) => (!activeCat || p.category === activeCat) &&
        (!query || (p.title + ' ' + (p.summary || '')).toLowerCase().includes(query)));
      if (!f.length) { list.innerHTML = `<div style="grid-column:1/-1">${emptyBox(query || activeCat ? 'Keine Treffer.' : 'Noch keine Beiträge. Schau bald wieder vorbei. 👋')}</div>`; return; }
      list.innerHTML = card(f[0], f.length > 2) + f.slice(1).map((p) => card(p, false)).join('');
    }
    filters.querySelectorAll('button').forEach((b) => b.onclick = () => {
      filters.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
      activeCat = b.dataset.c; draw();
    });
    const si = document.getElementById('newsSearch');
    si.addEventListener('input', () => { query = si.value.trim().toLowerCase(); draw(); });
    draw();
    return registerSlashFocus(si);
  }

  // ---- ARTICLE ----
  async function renderArticle(slug) {
    view().innerHTML = `<div class="wrap"><div class="article">${skel('', 1, 400)}</div></div>`;
    let post;
    try { post = (await P.json('/api/news/' + encodeURIComponent(slug))).post; }
    catch {
      document.title = 'Beitrag nicht gefunden · Ping';
      view().innerHTML = `<div class="wrap"><div class="empty"><span class="em">∅</span>Diesen Artikel gibt es nicht (mehr).<br><a class="btn sm" style="margin-top:14px" href="/news">← Zum Newsroom</a></div></div>`;
      return;
    }
    document.title = post.title + ' · Ping Newsroom';
    const url = location.origin + '/news/' + encodeURIComponent(post.slug);
    view().innerHTML = `<div class="read-progress" id="readbar"></div>
      <div class="wrap"><article class="article">
        <a class="back" href="/news">← Newsroom</a>
        ${post.category ? `<div><span class="pill news">${P.esc(post.category)}</span></div>` : ''}
        <h1>${P.esc(post.title)}</h1>
        ${post.summary ? `<p class="summary">${P.esc(post.summary)}</p>` : ''}
        <div class="ameta"><span>${P.esc(post.author || 'Ping Team')}</span><span>· ${P.fmtDate(post.publishedAt || post.createdAt)}</span><span>· ${readTime(post.body)} min Lesezeit</span>
          <span class="share"><button class="icon-btn" id="shareBtn" title="Teilen">${P.icon('share')}</button><button class="icon-btn" id="copyBtn" title="Link kopieren">${P.icon('link')}</button></span></div>
        ${post.cover ? `<div class="cover-img" style="background-image:url('${P.esc(post.cover)}')"></div>` : ''}
        <div class="prose">${P.richText(post.body)}</div>
        <div style="margin-top:40px;display:flex;gap:12px;flex-wrap:wrap"><a class="btn" href="/download">${P.icon('download')}Ping herunterladen</a><a class="btn ghost" href="/news">Mehr Newsroom</a></div>
      </article></div>`;
    document.getElementById('shareBtn').onclick = () => P.share({ title: post.title, text: post.summary || '', url });
    document.getElementById('copyBtn').onclick = () => P.copy(url, 'Link kopiert.');
    const bar = document.getElementById('readbar');
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, (scrollY / h) * 100) : 0) + '%';
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    return () => removeEventListener('scroll', onScroll);
  }
  function readTime(body) { return Math.max(1, Math.round(String(body || '').split(/\s+/).length / 200)); }

  // ---- CHANGELOG ----
  async function renderChangelog() {
    document.title = 'Changelog · Ping';
    view().innerHTML = `<div class="wrap">
      <div class="page-head reveal"><span class="kicker">Changelog</span>
        <h1 class="h1">Was ist neu in Ping?</h1>
        <p>Jede Funktion, Verbesserung und Korrektur — transparent und nach Version sortiert.</p></div>
      <div class="toolbar reveal">
        <label class="search">${P.icon('search')}<input id="clSearch" placeholder="Changelog durchsuchen …" autocomplete="off"><kbd>/</kbd></label>
        <div class="filters" id="clFilters">
          <button class="active" data-f="">Alles</button>
          <button data-f="feature">Neu</button><button data-f="improvement">Verbessert</button>
          <button data-f="fix">Behoben</button><button data-f="security">Sicherheit</button>
        </div>
      </div>
      <div class="timeline" id="timeline">${skel('', 3, 130)}</div>
    </div>`;
    let all = [];
    try { all = (await P.json('/api/changelog')).posts || []; }
    catch { document.getElementById('timeline').outerHTML = emptyBox('Changelog gerade nicht erreichbar.'); return; }
    let filter = '', query = '';
    const tl = document.getElementById('timeline');
    const entry = (p) => {
      const ver = p.version ? `<span class="ver">v${P.esc(p.version)}</span>` : `<span class="ver">${P.esc(p.title)}</span>`;
      return `<div class="entry"><div class="card">
        <div class="top">${ver}${p.tag ? `<span class="pill ${P.esc(p.tag)}">${P.esc(P.tag(p.tag))}</span>` : ''}<span class="date">${P.fmtDate(p.publishedAt || p.createdAt)}</span></div>
        ${p.version ? `<h3>${P.esc(p.title)}</h3>` : ''}
        ${p.summary ? `<p class="summary">${P.esc(p.summary)}</p>` : ''}
        <div class="prose">${P.richText(p.body)}</div></div></div>`;
    };
    function draw() {
      const f = all.filter((p) => (!filter || p.tag === filter) &&
        (!query || (p.title + ' ' + (p.summary || '') + ' ' + (p.body || '') + ' ' + (p.version || '')).toLowerCase().includes(query)));
      tl.innerHTML = f.length ? f.map(entry).join('') : `<div class="empty">Keine Einträge${filter || query ? ' für diese Auswahl' : ''}.</div>`;
    }
    document.querySelectorAll('#clFilters button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#clFilters button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); filter = b.dataset.f; draw();
    });
    const si = document.getElementById('clSearch');
    si.addEventListener('input', () => { query = si.value.trim().toLowerCase(); draw(); });
    draw();
    return registerSlashFocus(si);
  }

  // ---- STATUS ----
  function renderStatus() {
    document.title = 'System-Status · Ping';
    view().innerHTML = `<div class="wrap">
      <div class="page-head reveal"><span class="kicker">System-Status</span>
        <h1 class="h1">Läuft alles?</h1><p>Live-Überblick über die Ping-Dienste. Diese Seite aktualisiert sich automatisch.</p></div>
      <div class="status-banner ok reveal" id="banner"><div class="big-led" id="bannerLed">${P.icon('check')}</div>
        <div><h2 id="bannerTitle">Status wird geprüft …</h2><p id="bannerSub">Einen Moment.</p></div></div>
      <div id="components" class="reveal"></div>
      <div class="statgrid reveal" id="statgrid"></div>
      <p class="muted mono reveal" id="metaRow" style="text-align:center;margin-top:22px;font-size:13px"></p>
    </div>`;
    const lat = []; // recent measured API latencies (ms) → sparkline
    async function refresh() {
      const t0 = performance.now();
      let health = null, stats = null;
      try { health = await P.json('/health'); } catch {}
      const ms = Math.round(performance.now() - t0);
      try { stats = await P.json('/api/public/stats'); } catch {}
      lat.push(health ? ms : 0); if (lat.length > 24) lat.shift();
      const apiOk = !!(health && health.ok), dataOk = !!stats, allOk = apiOk && dataOk;
      const banner = document.getElementById('banner'); if (!banner) return;
      banner.className = 'status-banner reveal in ' + (allOk ? 'ok' : 'down');
      document.getElementById('bannerLed').innerHTML = P.icon(allOk ? 'check' : 'close');
      document.getElementById('bannerTitle').textContent = allOk ? 'Alle Systeme betriebsbereit' : 'Eingeschränkter Betrieb';
      document.getElementById('bannerSub').textContent = `Letzte Prüfung ${new Date().toLocaleTimeString('de-DE')} · ${apiOk ? ms + ' ms' : 'keine Antwort'}`;
      const comp = (name, desc, ok) => `<div class="comp"><div class="l"><b>${name}</b><span>${desc}</span></div>
        <div class="r ${ok ? 'ok' : 'down'}"><span class="led ${ok ? '' : 'down'}"></span>${ok ? 'Betriebsbereit' : 'Gestört'}</div></div>`;
      const max = Math.max(1, ...lat);
      const spark = `<div class="comp"><div class="l"><b>Antwortzeit</b><span>API-Latenz dieser Sitzung</span></div>
        <div class="spark">${lat.map((v) => `<i style="height:${Math.max(3, (v / max) * 30)}px;opacity:${v ? 0.8 : 0.25}"></i>`).join('')}</div></div>`;
      document.getElementById('components').innerHTML =
        comp('API', 'Anmeldung, Chats & Nachrichten', apiOk) +
        comp('Echtzeit-Verbindung', 'Live-Nachrichten über WebSocket', apiOk) +
        comp('Status & Medien', 'Status-Updates und Datei-Uploads', apiOk) +
        comp('Daten-API', 'Newsroom, Changelog & Statistik', dataOk) + spark;
      if (stats) {
        const box = (n, k) => `<div class="sbox"><div class="n">${P.count(n)}</div><div class="k">${k}</div></div>`;
        document.getElementById('statgrid').innerHTML =
          box(stats.online, 'Gerade online') + box(stats.users, 'Nutzer') + box(stats.messages, 'Nachrichten') + box(stats.statuses, 'Status aktiv');
        document.getElementById('metaRow').textContent = `Version ${stats.version} · Uptime ${fmtUptime(stats.uptimeSec)}`;
      }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }
  function fmtUptime(s) { if (!s) return '–'; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; }

  // ---- LEGAL ----
  function renderLegal() {
    document.title = 'Impressum & Datenschutz · Ping';
    view().innerHTML = `<div class="wrap"><div class="legal">
      <div class="page-head reveal" style="padding-bottom:18px"><span class="kicker">Rechtliches</span>
        <h1 class="h1">Impressum & Datenschutz</h1>
        <p>Wer Ping betreibt und wie wir mit deinen Daten umgehen — klar und vollständig erklärt.</p></div>
      <div class="toc reveal">
        <a href="/legal#impressum">Impressum</a><a href="/legal#datenschutz">Datenschutz</a>
        <a href="/legal#rechte">Deine Rechte</a><a href="/legal#kontakt">Kontakt</a></div>

      <h2 id="impressum" class="reveal">Impressum</h2>
      <div class="card reveal">
        <h3>Angaben gemäß § 5 ECG und § 25 MedienG</h3>
        <p>Ping ist ein privates, nicht-kommerzielles Projekt ohne Gewinnabsicht.</p>
        <p><strong>Medieninhaber, Herausgeber &amp; Betreiber:</strong><br>
          Benjamin Berger (Privatperson)<br>Österreich</p>
        <h3>Kontakt</h3>
        <p>E-Mail: <a href="mailto:user@example.invalid">user@example.invalid</a><br>
          Web: example.invalid</p>
        <p class="muted" style="font-size:13.5px">Da Ping privat und ohne Gewerbe betrieben wird, erfolgt der Kontakt
          per E-Mail. Eine ladungsfähige Anschrift wird auf berechtigte rechtliche Anfrage bekannt gegeben.</p>
        <h3>Für den Inhalt verantwortlich</h3><p>Benjamin Berger</p>
        <h3>Online-Streitbeilegung</h3>
        <p class="muted" style="font-size:13.5px">Es besteht keine Verpflichtung und keine Bereitschaft zur Teilnahme an einem
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle.</p>
      </div>

      <h2 id="datenschutz" class="reveal">Datenschutzerklärung</h2>
      <div class="card reveal">
        <h3>1. Verantwortlicher</h3>
        <p>Verantwortlich für die Datenverarbeitung im Sinne der Datenschutz-Grundverordnung (DSGVO) ist
          Benjamin Berger, erreichbar unter <a href="mailto:user@example.invalid">user@example.invalid</a>.</p>

        <h3>2. Unser Grundsatz</h3>
        <p>Ping ist bewusst datensparsam. Wir verarbeiten nur Daten, die für den Betrieb des Messengers nötig sind.
          Es gibt keine Werbung, kein Werbe-Tracking und keinen Verkauf von Daten an Dritte.</p>

        <h3>3. Welche Daten wir verarbeiten — und auf welcher Grundlage</h3>
        <ul>
          <li><strong>Kontodaten</strong> (Telefonnummer, E-Mail-Adresse, Anzeigename, gehashtes Passwort, optionales
            Profilbild): zur Bereitstellung deines Kontos. Rechtsgrundlage: Vertragserfüllung, Art. 6 Abs. 1 lit. b DSGVO.</li>
          <li><strong>Nachrichten &amp; Medien</strong>: werden gespeichert, um sie an deine Empfänger zuzustellen.
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Im Modus „lokale Speicherung“ werden gelesene Nachrichten
            serverseitig wieder gelöscht.</li>
          <li><strong>Status-Updates</strong>: werden 24 Stunden lang angezeigt und danach automatisch gelöscht.
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</li>
          <li><strong>Telefon-Verifizierung</strong> (einmaliger SMS-Code): zur Bestätigung deiner Nummer und zum Schutz
            vor Missbrauch. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO.</li>
          <li><strong>Technische Daten</strong> (IP-Adresse, Zeitstempel, Server-Protokolle): zum sicheren Betrieb und
            zur Abwehr von Missbrauch. Rechtsgrundlage: berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO.</li>
          <li><strong>Push-Token</strong> für Benachrichtigungen: nur, wenn du Benachrichtigungen aktivierst.
            Rechtsgrundlage: Einwilligung bzw. Vertragserfüllung, Art. 6 Abs. 1 lit. a/b DSGVO.</li>
        </ul>

        <h3>4. Kontakte</h3>
        <p>Der Abgleich deiner Kontakte findet ausschließlich flüchtig im Arbeitsspeicher statt. Dein Adressbuch wird
          niemals dauerhaft gespeichert. Gefunden wirst du nur über deine Telefonnummer — nie über eine Namens- oder
          E-Mail-Suche.</p>

        <h3>5. Empfänger &amp; Auftragsverarbeiter</h3>
        <p>Zur Erbringung des Dienstes setzen wir sorgfältig ausgewählte Dienstleister ein:</p>
        <ul>
          <li><strong>Google Firebase Cloud Messaging</strong> (Google Ireland Ltd.): zustellen von Push-Benachrichtigungen.
            Dabei wird ein Gerätetoken übermittelt.</li>
          <li><strong>Cloudflare</strong>: Bereitstellung, Sicherheit und Beschleunigung der Verbindung. Dabei werden
            Verbindungsdaten (u. a. IP-Adresse) verarbeitet.</li>
          <li><strong>SMS-Dienstleister</strong>: Versand des einmaligen Verifizierungscodes an deine Telefonnummer
            (sofern dieser Versand aktiviert ist).</li>
        </ul>
        <p class="muted" style="font-size:13.5px">Bei diesen Diensten kann eine Übermittlung in Drittländer (z. B. USA)
          stattfinden. Sie ist durch geeignete Garantien wie EU-Standardvertragsklauseln bzw. das EU-US Data Privacy
          Framework abgesichert.</p>

        <h3>6. Speicherdauer &amp; Löschung</h3>
        <p>Kontodaten und Inhalte speichern wir, solange dein Konto besteht. Du kannst dein Konto jederzeit in der App
          löschen — damit werden deine zugehörigen Daten entfernt. Status-Updates werden nach 24 Stunden automatisch
          gelöscht, technische Protokolle nur kurz aufbewahrt.</p>

        <h3>7. Datensicherheit</h3>
        <p>Die Verbindung zwischen App und Server ist per TLS (HTTPS) verschlüsselt. Passwörter werden ausschließlich als
          sicherer Hash gespeichert, niemals im Klartext. Bitte beachte: Nachrichten werden zur Zustellung auf dem Server
          gespeichert und sind nicht Ende-zu-Ende-verschlüsselt.</p>

        <h3>8. Keine automatisierte Entscheidungsfindung</h3>
        <p>Es findet keine automatisierte Entscheidungsfindung oder Profilbildung im Sinne des Art. 22 DSGVO statt.</p>

        <h3 id="rechte">9. Deine Rechte</h3>
        <p>Du hast jederzeit das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung
          der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21). Eine erteilte Einwilligung
          kannst du jederzeit mit Wirkung für die Zukunft widerrufen. In der App kannst du deine Daten unter
          „Backup &amp; Export“ selbst exportieren und dein Konto vollständig löschen.</p>
        <p>Du hast außerdem das Recht auf Beschwerde bei der Aufsichtsbehörde:<br>
          <strong>Österreichische Datenschutzbehörde</strong>, Barichgasse 40–42, 1030 Wien,
          <a href="https://www.dsb.gv.at" target="_blank" rel="noopener">dsb.gv.at</a>.</p>

        <h3>10. Diese Website</h3>
        <p>Diese Website verwendet keine Werbe- oder Analyse-Cookies und kein Tracking. Lediglich eine technisch
          notwendige Einstellung (dein gewähltes Design hell/dunkel) wird lokal in deinem Browser gespeichert. Beim Abruf
          der Seite fallen serverseitig übliche Zugriffsdaten (u. a. IP-Adresse) zur Auslieferung und Sicherheit an.</p>

        <h3 id="kontakt">11. Kontakt</h3>
        <p>Bei Fragen zum Datenschutz erreichst du uns unter
          <a href="mailto:user@example.invalid">user@example.invalid</a>.</p>

        <h3>12. Änderungen</h3>
        <p>Wir passen diese Erklärung an, wenn sich der Dienst oder die Rechtslage ändert. Es gilt jeweils die hier
          veröffentlichte Fassung.</p>
      </div>
      <p class="muted mono" style="font-size:12.5px">Stand: ${P.fmtDate(Date.now())}</p>
    </div></div>`;
    if (location.hash) scrollToHash(location.hash);
  }

  // ------------------------------------------------------------- utilities ---
  function emptyBox(msg) { return `<div class="empty"><span class="em">∅</span>${msg}</div>`; }
  function registerSlashFocus(input) {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== input && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }

  // -------------------------------------------------------- back-to-top ------
  function mountBackToTop() {
    const b = document.createElement('button');
    b.className = 'to-top'; b.setAttribute('aria-label', 'Nach oben'); b.innerHTML = P.icon('arrowUp');
    b.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(b);
    addEventListener('scroll', () => b.classList.toggle('show', scrollY > 600), { passive: true });
  }

  // ----------------------------------------------------------------- boot ----
  function boot() {
    document.body.insertAdjacentHTML('afterbegin', '<div class="atmos"></div><div class="grain"></div>');
    applyTheme(currentTheme());
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (currentTheme() === 'system') applyTheme('system'); });
    renderChrome();
    applyTheme(currentTheme());
    mountBackToTop();
    route(location.hash || null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
