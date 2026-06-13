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
  if (cache && cache.full === latest.full && cache.mtime === latest.mtime) {
    return cache;
  }
  let sha = '';
  try {
    sha = crypto.createHash('sha256').update(fs.readFileSync(latest.full)).digest('hex');
  } catch {
    /* ignore */
  }
  // Optional sidecar version.json (written by scripts/publish-apk.sh).
  let version = null;
  let build = null;
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(path.dirname(latest.full), 'version.json'), 'utf8')
    );
    version = meta.version || null;
    build = meta.build || null;
  } catch {
    /* derive from filename */
  }
  if (!version) {
    const m = latest.f.match(/(\d+\.\d+\.\d+(?:\+\d+)?)/);
    version = m ? m[1].split('+')[0] : '2.0.0';
    if (m && m[1].includes('+')) build = m[1];
  }
  // The Android version code (build number) is the part after "+" in
  // "<name>+<code>". The app compares this integer to decide if an update is
  // available — far more reliable than parsing a semver string.
  let versionCode = null;
  const plus = (build || '').split('+')[1];
  if (plus && /^\d+$/.test(plus)) versionCode = Number(plus);
  cache = {
    ...latest,
    sha,
    version,
    build: build || version,
    versionCode,
    updatedAt: Math.round(latest.mtime),
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

  // Marketing site sub-pages. The newsroom, changelog and status pages are
  // static shells that fill themselves in from the public JSON API
  // (/api/news, /api/changelog, /api/public/stats). `/news/:slug` serves the
  // same shell, which reads the slug from the URL to render a single article.
  const page = (name) => (_req, res) => res.sendFile(path.join(publicDir, name));
  app.get('/news', page('news.html'));
  app.get('/news/:slug', page('news.html'));
  app.get('/changelog', page('changelog.html'));
  app.get('/status', page('status.html'));
  app.get('/legal', page('legal.html'));

  // Shared design system + helpers, served with long-lived caching headers.
  const asset = (name, type) => (_req, res) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicDir, name));
  };
  app.get('/site.css', asset('site.css', 'text/css; charset=utf-8'));
  app.get('/site.js', asset('site.js', 'application/javascript; charset=utf-8'));

  // Metadata for the landing page (version / size / hash).
  app.get('/download/info', (_req, res) => {
    const info = apkInfo();
    if (!info) return res.status(404).json({ error: 'Noch kein Build verfügbar.' });
    res.json({
      version: info.version,
      build: info.build,
      versionCode: info.versionCode,
      size: info.size,
      sha256: info.sha,
      updatedAt: info.updatedAt,
      filename: `ping-${info.version}.apk`,
      url: '/download',
    });
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
}
