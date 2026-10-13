// The house: tap a room on the plan (or in 3D) to control its devices
// and see its chores. Rooms glow when their lights are on.
//
// Options:
//   floors: [{ name, plan }]   plan = an SVG whose room shapes have
//                              id="room_<room id>" (see README)
//   model:  { obj, mtl, name, camera: [x, y, z] } optional 3D model;
//           floor meshes named room_<id>
//   view:   index of the floor to show first, or "3d"

import { deviceRow, isOn, isSwitchable, roomClimate, ensureDeviceStyles } from '/lib/device-ui.js';
import { choreRow, editChore } from './chores.js';

const CSS = `
  [data-type="house"] .card-body { padding: 0; overflow: hidden; }
  .house { display: grid; grid-template-columns: minmax(0, 1fr) min(380px, 40%); height: 100%; }
  .house-view { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 8px 12px 16px; }
  .house-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .house-tabs button { min-height: 40px; padding: 0 16px; border: 0; border-radius: 99px; background: var(--chip); color: var(--muted); font-weight: 600; }
  .house-tabs button[aria-selected="true"] { background: var(--accent); color: var(--accent-text); }
  .house-stage { position: relative; flex: 1; min-height: 280px; container-type: size; display: flex; align-items: center; justify-content: center; }
  .house-stage.three { display: block; }
  .plan-wrap { position: relative; aspect-ratio: var(--ar, 1); width: min(100cqw, calc(100cqh * var(--ar, 1))); }
  .plan-wrap svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .plan-wrap image { filter: var(--plan-filter); }
  .plan-wrap [data-room] { fill: transparent; stroke: transparent; stroke-width: 3px; vector-effect: non-scaling-stroke; cursor: pointer; transition: fill .25s; outline: none; }
  .plan-wrap [data-room].lit { fill: var(--glow); }
  .plan-wrap [data-room].selected { stroke: var(--accent); fill: color-mix(in srgb, var(--accent) 22%, transparent); }
  .plan-wrap [data-room].lit.selected { fill: var(--glow); }
  .plan-wrap [data-room]:focus-visible { stroke: var(--text); }
  .plan-chips { position: absolute; inset: 0; pointer-events: none; }
  .room-chip { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border: 0; border-radius: 99px; background: var(--card); color: var(--text); font-size: 12px; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 6px rgba(0,0,0,.35); }
  .room-chip .t { color: var(--muted); font-weight: 600; }
  .room-chip.lit { background: #ffc35c; color: #2a1a00; }
  .room-chip.lit .t { color: #5a3d00; }
  .room-chip.selected { outline: 3px solid var(--accent); }
  .room-chip .jobs { min-width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center; background: var(--warn); color: #1b1300; font-size: 11px; }
  .house-panel { min-height: 0; overflow: auto; padding: 14px 18px; border-left: 1px solid var(--line); }
  .house-panel h3 { margin: 0; font-size: 22px; }
  .panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .panel-head .btn { margin-left: auto; }
  .panel-sub { color: var(--muted); margin-bottom: 12px; }
  .panel-section { margin: 18px 0 4px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; }
  .panel-section .btn { margin-left: auto; }
  .scenes { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-top: 8px; }
  .scenes button { min-height: 64px; border: 0; border-radius: 14px; background: var(--chip); font-weight: 600; display: grid; place-items: center; gap: 2px; padding: 6px; }
  .scenes .i { font-size: 22px; }
  .room-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; }
  .room-row:last-child { border-bottom: 0; }
  .room-row .n { flex: 1; font-weight: 600; }
  .room-row .lamp { color: var(--warn); font-weight: 700; }
  .back { min-height: 40px; padding: 0 12px 0 6px; border: 0; background: none; color: var(--accent); font-weight: 600; margin: -6px 0 6px -6px; }
  @container (max-width: 760px) {
    .house { grid-template-columns: 1fr; grid-template-rows: 380px auto; height: auto; }
    .house-panel { border-left: 0; border-top: 1px solid var(--line); overflow: visible; }
  }
  /* small plans: smaller labels, no temperatures */
  @container (max-width: 480px) {
    .room-chip { min-height: 24px; padding: 0 7px; font-size: 11px; }
    .room-chip .t { display: none; }
  }
  @media (max-width: 1000px) {
    .card[data-type="house"] { max-height: none; }
  }
`;

// A good spot for a label inside a polygon: the sampled point furthest
// from every edge (works for L-shaped rooms where the centre is outside).
function labelPoint(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edgeDist = (x, y) => Math.min(...pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  }));
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -1;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N, y = y0 + ((y1 - y0) * j) / N;
      if (!inside(x, y)) continue;
      const d = edgeDist(x, y);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best;
}

// Loads a plan SVG and keeps only shapes and images: no scripts, styles
// or ids that could clash with the page.
async function loadPlan(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg') throw new Error(`${url} is not an SVG`);
  svg.querySelectorAll('script, foreignObject, style').forEach((n) => n.remove());
  for (const n of svg.querySelectorAll('*')) {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
    if (n.id?.startsWith('room_')) n.setAttribute('data-room', n.id.slice(5));
    n.removeAttribute('id');
    n.removeAttribute('class');
  }
  const [vx, vy, vw, vh] = (svg.getAttribute('viewBox') || `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`).split(/[\s,]+/).map(Number);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return { svg: document.importNode(svg, true), box: { x: vx, y: vy, w: vw, h: vh } };
}

export default async function house(el, opts, ctx) {
  const { h, api, on, room: findRoom } = ctx;
  ensureDeviceStyles();
  el.append(h('style', {}, CSS));

  const views = [
    ...(opts.floors || []).map((f, i) => ({ key: `floor${i}`, name: f.name || `Floor ${i + 1}`, plan: f.plan })),
    ...(opts.model?.obj ? [{ key: '3d', name: opts.model.name || '3D', model: opts.model }] : []),
  ];
  const first = opts.view === '3d' ? '3d' : `floor${Number(opts.view) || 0}`;
  let current = views.find((v) => v.key === first)?.key || views[0]?.key;
  let selected = null;
  let devices = [];
  let scenes = [];
  let chores = [];

  const tabs = h('div', { class: 'house-tabs', role: 'tablist' });
  const stage = h('div', { class: 'house-stage' });
  const panel = h('aside', { class: 'house-panel', 'aria-live': 'polite' });
  el.append(h('div', { class: 'house' }, h('div', { class: 'house-view' }, tabs, stage), panel));

  const chipEls = new Map();   // view key -> [[roomId, chip]]
  const shapeEls = new Map();  // view key -> [[roomId, shape]]
  const plans = new Map();     // view key -> plan element (cached)
  let three = null;

  const roomName = (id) => findRoom(id)?.name || id.replace(/_/g, ' ');
  const shortName = (id) => findRoom(id)?.short || roomName(id);
  const choreRoom = (c) => findRoom(c.room)?.id || c.room;

  function info(id) {
    const devs = devices.filter((d) => d.room === id);
    const lit = devs.some((d) => d.type === 'light' && isOn(d));
    const onCount = devs.filter((d) => isSwitchable(d) && isOn(d)).length;
    const jobs = chores.filter((c) => choreRoom(c) === id && !c.done).length;
    return { devs, lit, onCount, jobs, ...roomClimate(devs) };
  }

  function fillChip(chip, id) {
    const i = info(id);
    chip.className = `room-chip${i.lit ? ' lit' : ''}${selected === id ? ' selected' : ''}`;
    chip.setAttribute('aria-label', `${roomName(id)}${i.temperature != null ? `, ${Math.round(i.temperature * 10) / 10} degrees` : ''}${i.lit ? ', lights on' : ''}`);
    chip.replaceChildren(
      i.lit ? '💡 ' : '',
      shortName(id),
      i.temperature != null ? h('span', { class: 't' }, `${Math.round(i.temperature * 10) / 10}°`) : '',
      i.jobs ? h('span', { class: 'jobs', title: `${i.jobs} chores to do` }, i.jobs) : '',
    );
  }

  function makeChip(id) {
    const chip = h('button', { type: 'button', class: 'room-chip', onClick: (e) => { e.stopPropagation(); select(id); } });
    fillChip(chip, id);
    return chip;
  }

  function refreshMap() {
    for (const [, list] of shapeEls) {
      for (const [id, shape] of list) {
        shape.classList.toggle('lit', info(id).lit);
        shape.classList.toggle('selected', selected === id);
      }
    }
    for (const [, list] of chipEls) for (const [id, chip] of list) fillChip(chip, id);
    if (three) {
      const states = new Map();
      for (const [id] of three.chips()) states.set(id, { lit: info(id).lit, selected: selected === id });
      three.update(states);
    }
  }

  // ---------- the map ----------

  async function planFor(v) {
    if (plans.has(v.key)) return plans.get(v.key);
    const { svg, box } = await loadPlan(v.plan);
    const wrap = h('div', { class: 'plan-wrap' });
    wrap.style.setProperty('--ar', box.w / box.h);
    const chipsLayer = h('div', { class: 'plan-chips' });
    wrap.append(svg, chipsLayer);
    const shapes = [];
    const chips = [];
    const seen = new Set();
    for (const shape of svg.querySelectorAll('[data-room]')) {
      const id = shape.getAttribute('data-room');
      shapes.push([id, shape]);
      shape.setAttribute('tabindex', '0');
      shape.setAttribute('role', 'button');
      shape.setAttribute('aria-label', roomName(id));
      shape.addEventListener('click', () => select(id));
      shape.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } });
      if (seen.has(id) || shape.nodeName !== 'polygon') continue;
      seen.add(id);
      const pts = shape.getAttribute('points').trim().split(/[\s,]+/).map(Number)
        .reduce((acc, n, i) => (i % 2 ? acc[acc.length - 1].push(n) : acc.push([n]), acc), []);
      const [x, y] = labelPoint(pts);
      const chip = makeChip(id);
      chip.style.left = `${((x - box.x) / box.w) * 100}%`;
      chip.style.top = `${((y - box.y) / box.h) * 100}%`;
      chipsLayer.append(chip);
      chips.push([id, chip]);
    }
    // Clicking empty space goes back to the whole house.
    svg.addEventListener('click', (e) => { if (!e.target.closest('[data-room]')) select(null); });
    shapeEls.set(v.key, shapes);
    chipEls.set(v.key, chips);
    plans.set(v.key, wrap);
    return wrap;
  }

  async function show(key) {
    current = key;
    tabs.replaceChildren(...views.map((v) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(v.key === key), onClick: () => show(v.key),
    }, v.name)));
    if (three) { three.dispose(); three = null; chipEls.delete('3d'); }
    const v = views.find((x) => x.key === key);
    stage.classList.toggle('three', !!v?.model);
    if (!v) { stage.replaceChildren(h('p', { class: 'empty' }, 'Add floors: to this widget in homepage.yaml.')); return; }
    try {
      if (v.model) {
        stage.replaceChildren(h('p', { class: 'empty' }, 'Loading 3D…'));
        const { mountHouse3D } = await import('/lib/house3d.js');
        if (current !== key) return;
        stage.replaceChildren();
        three = await mountHouse3D(stage, { obj: v.model.obj, mtl: v.model.mtl, camera: v.model.camera, chipFor: makeChip, onSelect: (id) => select(id) });
        if (current !== key) { three.dispose(); three = null; return; }
        chipEls.set('3d', three.chips());
      } else {
        stage.replaceChildren(await planFor(v));
      }
      refreshMap();
    } catch (err) {
      stage.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }

  // ---------- the side panel ----------

  function select(id) {
    selected = id && id === selected ? null : id;
    refreshMap();
    renderPanel();
  }

  async function act(path, body) {
    try {
      const r = await api(path, { method: 'POST', body });
      if (r.failed?.length) ctx.toast(r.failed.join('; '), { error: true });
    } catch (err) {
      ctx.toast(err.message, { error: true });
    }
  }

  // replaceChildren() does not flatten arrays.
  const fill = (...parts) => panel.replaceChildren(...parts.flat(2).filter((x) => x != null && x !== ''));

  let pending = false;
  panel.addEventListener('focusout', () => { if (pending) setTimeout(renderPanel); });

  function renderPanel() {
    // Don't redraw under a finger that is dragging a slider.
    if (panel.contains(document.activeElement) && document.activeElement.matches('input')) { pending = true; return; }
    pending = false;
    const scroll = panel.scrollTop;
    if (!selected) renderHouse(); else renderRoom(selected);
    panel.scrollTop = scroll;
  }

  function renderHouse() {
    const anyOn = devices.some((d) => isSwitchable(d) && isOn(d));
    const ids = [...new Set([...ctx.rooms.map((r) => r.id), ...devices.map((d) => d.room).filter(Boolean)])];
    fill(
      h('div', { class: 'panel-head' }, h('h3', {}, 'House'),
        anyOn ? h('button', { class: 'btn', type: 'button', onClick: () => act('/api/scenes/all-off') }, 'All off') : ''),
      h('div', { class: 'panel-sub' }, anyOn
        ? `${devices.filter((d) => isSwitchable(d) && isOn(d)).length} things on`
        : 'Everything is off'),
      scenes.length ? h('div', { class: 'scenes' }, scenes.filter((s) => s.id !== 'all-off').map((s) => h('button', {
        type: 'button', onClick: () => act(`/api/scenes/${encodeURIComponent(s.id)}`).then(() => ctx.toast(`${s.name} ✓`)),
      }, h('span', { class: 'i', 'aria-hidden': 'true' }, s.icon), s.name))) : '',
      h('div', { class: 'panel-section' }, 'Rooms'),
      ids.map((id) => {
        const i = info(id);
        return h('button', { type: 'button', class: 'room-row', onClick: () => select(id) },
          h('span', { class: 'n' }, roomName(id)),
          i.onCount ? h('span', { class: 'lamp' }, `💡 ${i.onCount}`) : '',
          i.temperature != null ? h('span', { class: 'muted' }, `${Math.round(i.temperature * 10) / 10}°`) : '',
          i.jobs ? h('span', { class: 'small muted' }, `${i.jobs} to do`) : '',
          h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'));
      }),
    );
  }

  function renderRoom(id) {
    const i = info(id);
    const roomChores = chores.filter((c) => choreRoom(c) === id)
      .sort((a, b) => Number(a.done) - Number(b.done));
    const sub = [
      i.temperature != null && `${Math.round(i.temperature * 10) / 10}°`,
      i.humidity != null && `💧${Math.round(i.humidity)}%`,
      `${i.devs.length} device${i.devs.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');
    fill(
      h('button', { class: 'back', type: 'button', onClick: () => select(null) }, '‹ Whole house'),
      h('div', { class: 'panel-head' }, h('h3', {}, roomName(id)),
        i.onCount ? h('button', { class: 'btn', type: 'button', onClick: () => act(`/api/rooms/${encodeURIComponent(id)}/off`) }, 'All off') : ''),
      h('div', { class: 'panel-sub' }, sub),
      i.devs.length ? i.devs.map((d) => deviceRow(ctx, d)) : h('p', { class: 'empty' }, 'No devices in this room yet. Add them under devices: in homepage.yaml.'),
      h('div', { class: 'panel-section' }, 'Chores',
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Add a chore', onClick: () => editChore(ctx, { room: id }, loadChores) }, '+')),
      roomChores.length ? roomChores.map((c) => choreRow(ctx, c, loadChores)) : h('p', { class: 'empty' }, 'No chores for this room.'),
    );
  }

  // ---------- data ----------

  async function loadDevices() {
    try {
      ({ devices, scenes } = await api('/api/devices'));
    } catch (err) {
      ctx.toast(`Devices: ${err.message}`, { error: true });
    }
    refreshMap();
    renderPanel();
  }
  async function loadChores() {
    try { ({ chores } = await api('/api/chores')); } catch { /* the map still works */ }
    refreshMap();
    renderPanel();
  }

  ctx.onDestroy(() => three?.dispose());
  on('devices', loadDevices);
  on('chores', loadChores);
  ctx.every(60_000, loadChores); // morning reset of daily chores
  await Promise.all([loadDevices(), loadChores()]);
  await show(current);
}
