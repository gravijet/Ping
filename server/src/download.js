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

// Stream a file with HTTP range support, so a client whose connection drops
// mid-download (e.g. Android's DownloadManager when the network flaps) can ask
// for just the remaining bytes instead of starting over. Advertises
// `Accept-Ranges` + a stable validator (ETag/Last-Modified) and answers a
// `Range:` request with 206 Partial Content; a malformed/unsatisfiable range
// gets a 416. Falls back to a normal 200 full-body stream otherwise.
function sendFileRanged(req, res, full, size, { type, filename, maxAge = 300 } = {}) {
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  if (filename) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  // A validator lets DownloadManager confirm (via If-Range) that the file hasn't
  // changed before it resumes a partial download.
  try {
    const mtimeMs = fs.statSync(full).mtimeMs;
    res.setHeader('Last-Modified', new Date(mtimeMs).toUTCString());
    res.setHeader('ETag', `"${size}-${Math.round(mtimeMs)}"`);
  } catch {
    /* validators are best-effort */
  }

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', size);
    return fs.createReadStream(full).pipe(res);
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  let start;
  let end;
  if (m[1] === '') {
    // Suffix range: the final N bytes.
    const n = parseInt(m[2], 10);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', end - start + 1);
  return fs.createReadStream(full, { start, end }).pipe(res);
}

function streamApk(req, res, info) {
  sendFileRanged(req, res, info.full, info.size, {
    type: 'application/vnd.android.package-archive',
    filename: `ping-${info.version}.apk`,
  });
}

// The Windows installer, hosted locally just like the APK. Returns the newest
// *.exe found in config.windowsDir with its size + a version (from the filename,
// e.g. "Ping-Setup-0.13.0.exe", or the WINDOWS_VERSION override), or null when
// none has been uploaded yet. Exported so the API (/api/desktop/version) can
// advertise the latest desktop build to the running Windows shell for its
// background auto-updater.
export function windowsInfo() {
  let entries = [];
  try {
    entries = fs.readdirSync(config.windowsDir);
  } catch {
    return null;
  }
  const exes = entries
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => {
      const full = path.join(config.windowsDir, f);
      try {
        const st = fs.statSync(full);
        return { f, full, mtime: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  const latest = exes[0];
  if (!latest) return null;
  const m = latest.f.match(/(\d+\.\d+\.\d+)/);
  const version = config.windowsVersion || (m ? m[1] : null);
  return {
    full: latest.full,
    size: latest.size,
    version,
    updatedAt: Math.round(latest.mtime),
  };
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
      // The Windows desktop build. Present when a local .exe has been dropped in
      // (or, as a fallback, a download URL is configured). The site renders a
      // second "Für Windows" download card from this.
      windows: (() => {
        const win = windowsInfo();
        if (win) {
          return { url: '/download/windows', version: win.version, size: win.size, updatedAt: win.updatedAt };
        }
        if (config.windowsDownloadUrl) {
          return { url: '/download/windows', version: config.windowsVersion || null };
        }
        return null;
      })(),
    });
  });

  // Windows installer: streams the locally-hosted .exe (newest in windowsDir),
  // exactly like the APK download. Falls back to a redirect if only a download
  // URL is configured and no local file exists.
  const serveWindows = (req, res) => {
    const win = windowsInfo();
    if (win) {
      const name = `Ping-Setup-${win.version || 'latest'}.exe`;
      return sendFileRanged(req, res, win.full, win.size, {
        type: 'application/vnd.microsoft.portable-executable',
        filename: name,
      });
    }
    if (config.windowsDownloadUrl) {
      return res.redirect(302, config.windowsDownloadUrl);
    }
    return res
      .status(404)
      .type('text/plain; charset=utf-8')
      .send('Die Windows-Version ist noch nicht verfügbar.');
  };
  app.get('/download/windows', serveWindows);
  app.get('/download/windows.exe', serveWindows);

  // The Android download itself, under several friendly URLs (/download/android
  // is the explicit-platform alias alongside the bare /download default).
  const serve = (req, res) => {
    const info = apkInfo();
    if (!info) {
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('Noch kein Ping-Build verfügbar. Bitte später erneut versuchen.');
    }
    streamApk(req, res, info);
  };
  app.get('/download', serve);
  app.get('/download/android', serve);
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
    sendFileRanged(req, res, v.full, v.size, {
      type: 'application/vnd.android.package-archive',
      filename: `ping-${info.version}-${req.params.abi}.apk`,
    });
  });
}
