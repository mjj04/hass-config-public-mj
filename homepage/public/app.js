// Dashboard runtime: loads the config, draws the page grid and mounts one
// widget module per card. A widget is any file in public/widgets/ (or
// config/widgets/) that default-exports:
//
//   export default async function (el, options, ctx) { ... }
//
// `el` is the card body, `options` is the widget's block from
// homepage.yaml, and `ctx` is the toolkit below. Intervals and live
// subscriptions made through ctx are cleaned up when the page changes.

let config;
let mounted = [];
const listeners = new Map(); // topic -> Set<fn>

// ---------- helpers given to widgets ----------

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function makeFmt() {
  const { locale, timezone: timeZone } = config;
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const addDays = (key, n) => {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const fmt = {
    timeZone,
    locale,
    dayKey,
    addDays,
    time: (d) => new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
    date: (d, o = {}) => new Intl.DateTimeFormat(locale, { timeZone, ...o }).format(new Date(d)),
    hour: (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d)),
    // A YYYY-MM-DD as "Today", "Tomorrow" or "Wed 15 Oct".
    dayLabel(key, o = { weekday: 'short', day: 'numeric', month: 'short' }) {
      const today = dayKey(new Date());
      if (key === today) return 'Today';
      if (key === addDays(today, 1)) return 'Tomorrow';
      if (key === addDays(today, -1)) return 'Yesterday';
      return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }).format(new Date(`${key}T12:00:00Z`));
    },
    since(iso) {
      if (!iso) return '';
      return dayKey(new Date(iso)) === dayKey(new Date()) ? fmt.time(iso) : fmt.dayLabel(dayKey(new Date(iso)));
    },
    bytes(n) {
      if (n == null) return '–';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
    },
    duration(sec) {
      const d = Math.floor(sec / 86400), hr = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
      return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
    },
  };
  return fmt;
}

// Modal dialog. `body` is a Node; actions are { label, primary, danger,
// onClick } and the dialog closes unless onClick returns false.
function dialog({ title, body, actions = [{ label: 'Close' }] }) {
  const dlg = h('dialog', {},
    title && h('h3', {}, title),
    body,
    h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
      type: 'button',
      class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
      onClick: async () => {
        try {
          if ((await a.onClick?.()) !== false) dlg.close();
        } catch (err) {
          alert(err.message);
        }
      },
    }, a.label))));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Short message at the bottom of the screen.
function toast(message, { error = false } = {}) {
  const t = h('div', { class: `toast${error ? ' error' : ''}`, role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 3000);
  setTimeout(() => t.remove(), 3400);
}

function makeCtx(card, widget) {
  const timers = [];
  const subs = [];
  const cleanups = [];
  const fmt = makeFmt();
  const ctx = {
    h, api, fmt, dialog, toast,
    config,
    people: config.people,
    person: (id) => config.people.find((p) => p.id === id),
    rooms: config.rooms,
    // A room by id or name.
    room: (v) => config.rooms.find((r) => r.id === v || r.name === v),
    widget,
    // Run fn every ms while the page is open.
    every(ms, fn) { timers.push(setInterval(fn, ms)); },
    // Run fn when the server says `topic` changed (lists, chores, ...).
    on(topic, fn) {
      if (!listeners.has(topic)) listeners.set(topic, new Set());
      listeners.get(topic).add(fn);
      subs.push([topic, fn]);
    },
    // Add a button to the card header.
    action(label, onClick, title) {
      const btn = h('button', { class: 'btn icon', type: 'button', title: title || label, 'aria-label': title || label, onClick }, label);
      card.querySelector('.actions').append(btn);
      return btn;
    },
    setTitle(text) { const t = card.querySelector('h2'); if (t) t.textContent = text; },
    // Run fn when the page changes (free WebGL, observers, ...).
    onDestroy(fn) { cleanups.push(fn); },
    destroy() {
      timers.forEach(clearInterval);
      cleanups.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
      for (const [topic, fn] of subs) listeners.get(topic)?.delete(fn);
    },
  };
  return ctx;
}

// ---------- pages ----------

function currentPage() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return config.pages.find((p) => p.id === id) || config.pages[0];
}

function renderTabs(active) {
  const tabs = document.getElementById('tabs');
  tabs.replaceChildren(...config.pages.map((p) => h('a', {
    href: `#/${p.id}`,
    'aria-current': p === active ? 'page' : null,
  }, p.icon ? h('span', { 'aria-hidden': 'true' }, p.icon) : null, p.title)));
  tabs.hidden = config.pages.length < 2;
}

async function renderPage() {
  const page = currentPage();
  mounted.forEach((ctx) => ctx.destroy());
  mounted = [];
  renderTabs(page);
  document.title = page ? `${page.title} · ${config.title}` : config.title;

  const grid = document.getElementById('grid');
  grid.replaceChildren();
  if (!page) {
    grid.append(h('p', { class: 'empty' }, 'No pages yet. Add some under pages: in homepage.yaml.'));
    return;
  }

  for (const widget of page.widgets) {
    const body = h('div', { class: 'card-body' });
    const card = h('section', {
      class: `card${widget.bare ? ' bare' : ''}`,
      'data-type': widget.type,
      'data-wide': widget.w > 6 ? true : null,
    },
    h('div', { class: 'card-head' },
      widget.title ? h('h2', {}, widget.title) : null,
      h('div', { class: 'actions' })),
    body);
    card.style.setProperty('--w', widget.w);
    card.style.setProperty('--h', widget.h);
    grid.append(card);

    const ctx = makeCtx(card, widget);
    mounted.push(ctx);
    mountWidget(widget, body, ctx, card);
  }
}

async function mountWidget(widget, body, ctx, card) {
  try {
    const mod = await import(`/widgets/${encodeURIComponent(widget.type)}.js`);
    await mod.default(body, widget, ctx);
  } catch (err) {
    console.error(`Widget ${widget.type}:`, err);
    body.replaceChildren(h('p', { class: 'card-error' }, `${widget.type}: ${err.message}`));
  }
  // Hide empty headers so content gets the space.
  const head = card.querySelector('.card-head');
  if (!widget.title && !head.querySelector('.actions').children.length) head.remove();
}

// ---------- live updates ----------

function connect() {
  const live = document.getElementById('live');
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    live.classList.add('on');
    // The server restarted with new code or config: reload to pick it up.
    if (JSON.parse(e.data).version !== config.version) location.reload();
  });
  es.addEventListener('change', (e) => {
    const { topic } = JSON.parse(e.data);
    if (topic === 'config') return location.reload();
    listeners.get(topic)?.forEach((fn) => fn());
  });
  es.onerror = () => live.classList.remove('on');
}

// Go back to the first page after a while without a touch, so the wall
// tablet always drifts back to Home.
function idleReturn(seconds) {
  if (!seconds) return;
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.querySelector('dialog[open]')) return reset();
      if (currentPage() !== config.pages[0]) location.hash = `#/${config.pages[0].id}`;
    }, seconds * 1000);
  };
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, reset, { passive: true }));
  reset();
}

// Big screens (a 4K TV at 100%) get the layout of a 1600px-wide screen,
// zoomed up, so text and buttons stay readable from across the room.
// homepage.yaml `scale:` overrides: a number, or 1 to turn it off.
function fitScreen() {
  const root = document.documentElement;
  const auto = Math.max(1, Math.min(window.innerWidth / 1600, window.innerHeight / 900));
  const scale = typeof config.scale === 'number' && config.scale > 0 ? config.scale : auto;
  root.style.zoom = scale === 1 ? '' : String(scale);
  root.style.setProperty('--app-h', `${window.innerHeight / scale}px`);
}

async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* needs https; ignore */ }
}

async function boot() {
  try {
    config = await api('/api/config');
  } catch (err) {
    document.getElementById('grid').replaceChildren(h('p', { class: 'card-error' }, `Could not load config: ${err.message}`));
    setTimeout(() => location.reload(), 15_000);
    return;
  }
  if (config.theme === 'light' || config.theme === 'dark') document.documentElement.dataset.theme = config.theme;
  document.documentElement.lang = config.locale || 'en';
  document.getElementById('brand').textContent = config.title;
  fitScreen();
  addEventListener('resize', fitScreen);
  addEventListener('hashchange', renderPage);
  await renderPage();
  connect();
  idleReturn(config.idle_return);
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
}

boot();
