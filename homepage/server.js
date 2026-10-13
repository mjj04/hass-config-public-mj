// Family homepage server.
// Serves the dashboard in public/, a JSON API made of widget modules in
// server/ (plus any *.server.js in config/widgets/), and a live event
// stream so every screen updates when something changes.

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureConfig, loadConfig, publicConfig, watchConfig } from './lib/config.js';
import { createStore } from './lib/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || path.join(ROOT, 'config'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const VERSION = String(Date.now());

const configFile = await ensureConfig(CONFIG_DIR, path.join(ROOT, 'defaults'));
let config = await loadConfig(configFile);
const store = await createStore(DATA_DIR);
const clients = new Set();

function emit(topic) {
  const msg = `event: change\ndata: ${JSON.stringify({ topic })}\n\n`;
  for (const res of clients) res.write(msg);
}

watchConfig(configFile, (next) => {
  config = next;
  for (const { mod } of lifecycle) mod.configChanged?.(next);
  emit('config');
});

// ---------- routes ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const routes = [];
const lifecycle = []; // modules with start/configChanged/stop
function addRoutes(table, source) {
  for (const [key, handler] of Object.entries(table)) {
    const [method, pattern] = key.split(' ');
    const parts = pattern.split('/').filter(Boolean);
    routes.push({ method, parts, handler, source });
  }
}

function match(method, pathname) {
  const segs = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params = {};
    if (r.parts.every((p, i) => (p.startsWith(':') ? (params[p.slice(1)] = segs[i], true) : p === segs[i]))) {
      return { route: r, params };
    }
  }
  return null;
}

addRoutes({
  'GET /api/config': () => ({ ...publicConfig(config), version: VERSION }),
}, 'core');

async function loadWidgetModules(dir, filter) {
  let files = [];
  try { files = (await readdir(dir)).filter(filter).sort(); } catch { return; }
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      if (mod.routes) addRoutes(mod.routes, f);
      if (mod.start || mod.configChanged || mod.stop) lifecycle.push({ name: f, mod });
    } catch (err) {
      console.error(`Widget ${f} failed to load: ${err.message}`);
    }
  }
}
await loadWidgetModules(path.join(ROOT, 'server'), (f) => f.endsWith('.js'));
await loadWidgetModules(path.join(CONFIG_DIR, 'widgets'), (f) => f.endsWith('.server.js'));
for (const { name, mod } of lifecycle) {
  try {
    await mod.start?.({ store, emit, configDir: CONFIG_DIR, config });
  } catch (err) {
    console.error(`${name} failed to start: ${err.message}`);
  }
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/events') return openStream(req, res);
  const found = match(req.method, url.pathname);
  if (!found) return sendJson(res, 404, { error: 'Not found' });
  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const ctx = {
      req, url, body, params: found.params, store, emit,
      get config() { return config; },
      fail(status, message) { throw new HttpError(status, message); },
    };
    const result = await found.route.handler(ctx);
    sendJson(res, 200, result ?? { ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(`${req.method} ${url.pathname} [${found.route.source}]:`, err);
    sendJson(res, status, { error: err.message });
  }
}

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
};

// three.js for the 3D house, served from node_modules.
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

// Resolves a URL path inside a base folder, refusing anything that
// escapes it.
function within(base, rel) {
  const full = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`);
  return full.startsWith(base + path.sep) ? full : null;
}

async function serveStatic(res, pathname) {
  const candidates = [];
  if (pathname.startsWith('/widgets/')) {
    if (pathname.endsWith('.server.js')) return notFound(res);
    // Your own widgets in config/widgets win over the built-in ones.
    candidates.push(within(path.join(CONFIG_DIR, 'widgets'), pathname.slice('/widgets/'.length)));
  }
  if (pathname.startsWith('/vendor/three/')) {
    const rel = pathname.slice('/vendor/three/'.length);
    if (!/^(build|examples\/jsm)\//.test(rel)) return notFound(res);
    candidates.push(within(THREE_DIR, rel));
  } else if (pathname.startsWith('/assets/')) {
    candidates.push(within(path.join(CONFIG_DIR, 'assets'), pathname.slice('/assets/'.length)));
  } else {
    candidates.push(within(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1)));
  }
  for (const file of candidates.filter(Boolean)) {
    try {
      if (!(await stat(file)).isFile()) continue;
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(await readFile(file));
    } catch { /* try the next one */ }
  }
  return notFound(res);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    return await serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Family homepage on http://0.0.0.0:${PORT} (config ${configFile}, data ${DATA_DIR})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const res of clients) res.end();
    for (const { mod } of lifecycle) { try { mod.stop?.(); } catch { /* exiting */ } }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
