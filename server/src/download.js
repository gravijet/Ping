import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';

// Serves the public landing page and the latest Android build. Visiting `/`
// shows a small install page that immediately starts the APK download; `/download`
// (and a few friendly aliases) stream the newest *.apk found in config.apkDir.

// Cache the chosen APK + its metadata, keyed by mtime so a freshly-published
// build is picked up without a restart.
let cache = null;

function latestApk() {
  let dir = config.apkDir;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    entries = [];
  }
  let apks = entries.filter((f) => f.toLowerCase().endsWith('.apk'));
  // Fall back to the Flutter build output if the publish dir is empty, so a dev
  // box serves the latest build without an extra copy step.
  if (apks.length === 0) {
    const fallback = path.join(
      path.dirname(path.dirname(path.dirname(config.apkDir))),
      'app',
      'build',
      'app',
      'outputs',
      'flutter-apk'
    );
    try {
      const f = fs.readdirSync(fallback).filter((x) => x === 'app-release.apk');
      if (f.length) {
        dir = fallback;
        apks = f;
      }
    } catch {
      /* no fallback */
    }
  }
  if (apks.length === 0) return null;

  // Newest by mtime.
  const stated = apks
    .map((f) => {
      const full = path.join(dir, f);
      try {
        return { f, full, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return stated[0] || null;
}

function apkInfo() {
  const latest = latestApk();
  if (!latest) return null;
  const dir = path.dirname(latest.full);

  // Optional sidecar version.json (written by scripts/publish-apk.sh). It names
  // the universal APK explicitly and lists the per-ABI splits, so we never serve
  // a split as the default download by accident.
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
  } catch {
    /* derive everything from the file itself */
  }

  // The universal build: the file named in version.json if present, otherwise
  // the newest *.apk on disk.
  let universal = latest;
  if (meta && meta.file) {
    const full = path.join(dir, meta.file);
    try {
      const st = fs.statSync(full);
      universal = { f: meta.file, full, mtime: st.mtimeMs, size: st.size };
    } catch {
      /* named universal missing — keep the mtime pick */
    }
  }

  if (cache && cache.full === universal.full && cache.mtime === universal.mtime) {
    return cache;
  }

  let sha = (meta && meta.sha256) || '';
  if (!sha) {
    try {
      sha = crypto.createHash('sha256').update(fs.readFileSync(universal.full)).digest('hex');
    } catch {
      /* ignore */
    }
  }

  let version = (meta && meta.version) || null;
  let build = (meta && meta.build) || null;
  if (!version) {
    const m = universal.f.match(/(\d+\.\d+\.\d+(?:\+\d+)?)/);
    version = m ? m[1].split('+')[0] : '0.0.0';
    if (m && m[1].includes('+')) build = m[1];
  }
  // The Android version code (build number) is the part after "+" in
  // "<name>+<code>". The app compares this integer to decide if an update is
  // available — far more reliable than parsing a semver string.
  let versionCode = meta && Number.isInteger(meta.versionCode) ? meta.versionCode : null;
  if (versionCode === null) {
    const plus = (build || '').split('+')[1];
    if (plus && /^\d+$/.test(plus)) versionCode = Number(plus);
  }

  // Resolve the per-ABI splits that actually exist on disk.
  const variants = {};
  if (meta && meta.variants && typeof meta.variants === 'object') {
    for (const [abi, v] of Object.entries(meta.variants)) {
      if (!v || !v.file) continue;
      const full = path.join(dir, v.file);
      try {
        const st = fs.statSync(full);
        variants[abi] = {
          full,
          size: v.size || st.size,
          sha256: v.sha256 || '',
          // Per-split version metadata (written by publish-apk.sh from aapt).
          // The split's own ABI-offset version code lets the in-app updater
          // compare like-for-like against a split install.
          versionCode: Number.isInteger(v.versionCode) ? v.versionCode : null,
          version: v.version || version,
        };
      } catch {
        /* split missing on disk — skip it */
      }
    }
  }

  cache = {
    ...universal,
    sha,
    version,
    build: build || version,
    versionCode,
    updatedAt: Math.round(universal.mtime),
    variants,
  };
  return cache;
}

function streamApk(res, info) {
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="ping-${info.version}.apk"`);
  res.setHeader('Content-Length', info.size);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(info.full).pipe(res);
}

export function mountDownloads(app, publicDir) {
  // Landing page.
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // The marketing site is a single-page app: every route below serves the same
  // shell (index.html) and the client router (site.js) renders the right view
  // from the URL without a full reload. Serving the shell server-side keeps deep
  // links and the browser back/forward button working natively.
  const shell = (_req, res) => res.sendFile(path.join(publicDir, 'index.html'));
  app.get('/news', shell);
  app.get('/news/:slug', shell);
  app.get('/changelog', shell);
  app.get('/status', shell);
  app.get('/legal', shell);
  // A shared group-invite link lands on the install page (the app does the
  // actual joining by code). Keeps invite URLs from 404-ing.
  app.get('/join/:code', shell);

  // Shared design system + helpers, served with long-lived caching headers.
  const asset = (name, type) => (_req, res) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicDir, name));
  };
  app.get('/site.css', asset('site.css', 'text/css; charset=utf-8'));
  app.get('/site.js', asset('site.js', 'application/javascript; charset=utf-8'));

  // Metadata for the landing page + in-app updater (version / size / hash). The
  // `variants` map lets the app download the smaller APK split for its own CPU
  // ABI; the top-level fields stay the universal APK (default + fallback).
  app.get('/download/info', (_req, res) => {
    const info = apkInfo();
    if (!info) return res.status(404).json({ error: 'Noch kein Build verfügbar.' });
    const variants = {};
    for (const [abi, v] of Object.entries(info.variants || {})) {
      variants[abi] = {
        url: `/download/abi/${abi}`,
        size: v.size,
        sha256: v.sha256,
        versionCode: v.versionCode,
        version: v.version,
      };
    }
    res.json({
      version: info.version,
      build: info.build,
      versionCode: info.versionCode,
      size: info.size,
      sha256: info.sha,
      updatedAt: info.updatedAt,
      filename: `ping-${info.version}.apk`,
      url: '/download',
      variants,
      // The Windows desktop build (only present once WINDOWS_DOWNLOAD_URL is
      // configured). The site renders a second "Für Windows" download card from
      // this; the actual installer lives on a GitHub release.
      windows: config.windowsDownloadUrl
        ? { url: '/download/windows', version: config.windowsVersion || null }
        : null,
    });
  });

  // Windows installer: a stable redirect to the GitHub-release .exe. Keeping the
  // indirection here means the published URL on the site never changes even if
  // the release host does.
  app.get('/download/windows', (_req, res) => {
    if (!config.windowsDownloadUrl) {
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('Die Windows-Version ist noch nicht verfügbar.');
    }
    res.redirect(302, config.windowsDownloadUrl);
  });

  // The download itself, under several friendly URLs.
  const serve = (_req, res) => {
    const info = apkInfo();
    if (!info) {
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('Noch kein Ping-Build verfügbar. Bitte später erneut versuchen.');
    }
    streamApk(res, info);
  };
  app.get('/download', serve);
  app.get('/download/ping.apk', serve);
  app.get('/ping.apk', serve);
  app.get('/app-release.apk', serve);

  // A specific per-ABI split (smaller than the universal APK). The :abi segment
  // is only ever used as a lookup key into the known variants — never to build a
  // path — so it can't be used for traversal.
  app.get('/download/abi/:abi', (req, res) => {
    const info = apkInfo();
    const v = info && info.variants ? info.variants[req.params.abi] : null;
    if (!v) {
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('Für diese Architektur gibt es keinen passenden Build.');
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ping-${info.version}-${req.params.abi}.apk"`
    );
    res.setHeader('Content-Length', v.size);
    res.setHeader('Cache-Control', 'public, max-age=300');
    fs.createReadStream(v.full).pipe(res);
  });
}
