/* Ping marketing site — shared chrome (nav + footer) and helpers.
   Pages set <body data-active="news|changelog|status|legal|home"> and provide
   empty <div id="nav"></div> / <div id="footer"></div> mount points. */
(function () {
  const LOGO =
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 1-2Z" fill="white" opacity=".96"/><circle cx="9" cy="10.5" r="1.5" fill="#0a84ff"/><circle cx="13" cy="10.5" r="1.5" fill="#0a84ff"/><circle cx="17" cy="10.5" r="1.5" fill="#0a84ff"/></svg>';

  const NAV = [
    { href: '/#features', label: 'Funktionen', key: 'features' },
    { href: '/news', label: 'Newsroom', key: 'news' },
    { href: '/changelog', label: 'Changelog', key: 'changelog' },
    { href: '/status', label: 'Status', key: 'status' },
    { href: '/#faq', label: 'FAQ', key: 'faq' },
  ];

  const active = document.body.dataset.active || 'home';

  function renderNav() {
    const el = document.getElementById('nav');
    if (!el) return;
    const links = NAV.map(
      (n) =>
        `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.label}</a>`
    ).join('');
    el.outerHTML =
      `<nav id="nav"><div class="wrap nav-in">` +
      `<div class="brand"><a href="/"><span class="logo">${LOGO}</span><span class="nm">Ping</span></a></div>` +
      `<button class="menu-btn" aria-label="Menü" id="menuBtn">☰</button>` +
      `<div class="nav-links" id="navLinks">${links}<a class="nav-cta" href="/download">Herunterladen</a></div>` +
      `</div></nav>`;
    const nav = document.getElementById('nav');
    const links2 = document.getElementById('navLinks');
    document.getElementById('menuBtn').onclick = () => links2.classList.toggle('open');
    links2.querySelectorAll('a').forEach((a) => (a.onclick = () => links2.classList.remove('open')));
    addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10));
  }

  function renderFooter() {
    const el = document.getElementById('footer');
    if (!el) return;
    const yr = new Date().getFullYear();
    el.outerHTML = `<footer><div class="wrap">
      <div class="foot-grid">
        <div>
          <div class="brand"><a href="/"><span class="logo">${LOGO}</span><span class="nm">Ping</span></a></div>
          <p class="lead">Der blitzschnelle, werbefreie Messenger. Echtzeit-Chats, Gruppen, Status &amp; mehr – privat by default.</p>
          <p class="lead">🇦🇹 Made in Austria</p>
        </div>
        <div>
          <h4>Produkt</h4>
          <a href="/#features">Funktionen</a>
          <a href="/download">Download</a>
          <a href="/status">System-Status</a>
          <a href="/#how">Installation</a>
        </div>
        <div>
          <h4>Ressourcen</h4>
          <a href="/news">Newsroom</a>
          <a href="/changelog">Changelog</a>
          <a href="/#faq">FAQ</a>
          <a href="/download/info">Build-Info</a>
        </div>
        <div>
          <h4>Rechtliches</h4>
          <a href="/legal#impressum">Impressum</a>
          <a href="/legal#datenschutz">Datenschutz</a>
          <a href="mailto:user@example.invalid">Kontakt</a>
        </div>
      </div>
      <div class="foot-bottom">
        <div>© ${yr} Ping · Messenger</div>
        <div><span class="dot">●</span> <span id="footStatus">Alle Systeme online</span> · example.invalid</div>
      </div>
    </div></footer>`;
    // Live status dot in the footer (best-effort).
    fetch('/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = document.getElementById('footStatus');
        if (s) s.textContent = d && d.ok ? 'Alle Systeme online' : 'Eingeschränkt erreichbar';
      })
      .catch(() => {
        const s = document.getElementById('footStatus');
        if (s) s.textContent = 'Status unbekannt';
      });
  }

  function injectBg() {
    if (document.querySelector('.blobs')) return;
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="blobs"><div class="blob a"></div><div class="blob b"></div><div class="blob c"></div></div><div class="grid-overlay"></div>'
    );
  }

  // ---- helpers (exposed as window.Ping) ----
  const Ping = {
    esc: (s) =>
      String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      ),
    human(b) {
      if (b == null) return '—';
      const u = ['B', 'KB', 'MB', 'GB'];
      let i = 0,
        n = b;
      while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
      }
      return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
    },
    fmtDate(ms) {
      if (!ms) return '';
      try {
        return new Date(ms).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
      } catch {
        return '';
      }
    },
    relTime(ms) {
      if (!ms) return '';
      const s = Math.round((Date.now() - ms) / 1000);
      if (s < 60) return 'gerade eben';
      const m = Math.round(s / 60);
      if (m < 60) return `vor ${m} min`;
      const h = Math.round(m / 60);
      if (h < 24) return `vor ${h} h`;
      const d = Math.round(h / 24);
      if (d < 30) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
      return Ping.fmtDate(ms);
    },
    count(n) {
      return new Intl.NumberFormat('de-DE').format(n || 0);
    },
    async json(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    // Animate an element's number from 0 → target.
    countUp(el, target) {
      const dur = 900;
      const start = performance.now();
      function step(t) {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Ping.count(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },
    reveal() {
      const io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target);
            }
          }),
        { threshold: 0.12 }
      );
      document.querySelectorAll('.reveal').forEach((el, i) => {
        el.style.transitionDelay = (i % 4) * 0.06 + 's';
        io.observe(el);
      });
    },
    tag(t) {
      const labels = {
        feature: 'Neu',
        improvement: 'Verbessert',
        fix: 'Behoben',
        security: 'Sicherheit',
      };
      return labels[t] || t || '';
    },
    // Minimal, safe formatter for post bodies: escapes everything first, then
    // turns "## heading", "- bullet", **bold** and blank-line paragraphs into
    // HTML. No raw HTML from the input is ever trusted.
    richText(src) {
      const esc = Ping.esc;
      const inline = (s) =>
        esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      const lines = String(src || '').split(/\r?\n/);
      let out = '',
        list = false,
        para = [];
      const flushP = () => {
        if (para.length) {
          out += '<p>' + para.map(inline).join('<br>') + '</p>';
          para = [];
        }
      };
      const flushL = () => {
        if (list) {
          out += '</ul>';
          list = false;
        }
      };
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
          flushP();
          flushL();
          continue;
        }
        if (/^##\s+/.test(line)) {
          flushP();
          flushL();
          out += '<h3>' + inline(line.replace(/^##\s+/, '')) + '</h3>';
        } else if (/^[-*•]\s+/.test(line)) {
          flushP();
          if (!list) {
            out += '<ul>';
            list = true;
          }
          out += '<li>' + inline(line.replace(/^[-*•]\s+/, '')) + '</li>';
        } else {
          flushL();
          para.push(line);
        }
      }
      flushP();
      flushL();
      return out;
    },
  };
  window.Ping = Ping;

  function boot() {
    injectBg();
    renderNav();
    renderFooter();
    Ping.reveal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
