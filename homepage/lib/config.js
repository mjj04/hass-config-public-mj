// Loads config/homepage.yaml. On first run the defaults/ folder is copied
// into config/ so there is a file to edit. The file is watched and the
// new config is picked up without a restart.

import { cp, readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// Only these top-level keys are sent to the browser. Everything else
// (calendar URLs, server settings, API keys) stays on the server.
const PUBLIC_KEYS = ['title', 'locale', 'timezone', 'theme', 'scale', 'idle_return', 'people', 'rooms', 'pages'];

export async function ensureConfig(configDir, defaultsDir) {
  const file = path.join(configDir, 'homepage.yaml');
  try {
    await stat(file);
  } catch {
    await cp(defaultsDir, configDir, { recursive: true, force: false, errorOnExist: false });
    console.log(`No config found, copied defaults to ${configDir}`);
  }
  return file;
}

export async function loadConfig(file) {
  const raw = YAML.parse(await readFile(file, 'utf8')) || {};
  return normalise(raw);
}

function normalise(c) {
  c.title ??= 'Home';
  c.locale ??= 'en-GB';
  c.timezone ??= process.env.TZ || 'Europe/London';
  c.theme ??= 'auto';
  c.people = (c.people || []).map((p, i) => ({
    id: p.id || slug(p.name) || `person${i + 1}`,
    color: p.color || PALETTE[i % PALETTE.length],
    ...p,
  }));
  c.pages = (c.pages || []).map((page, i) => ({
    id: page.id || slug(page.title) || `page${i + 1}`,
    ...page,
    widgets: (page.widgets || []).map(upgradeWidget).map((w, j) => ({
      id: w.id || `${page.id || slug(page.title) || i}-${w.type}-${j}`,
      w: 4,
      h: 3,
      ...w,
    })),
  }));
  // Rooms are { id, name }. Plain names get an id like "bedroom_1",
  // which is also how rooms are named in the house plans and 3D model.
  c.rooms = (c.rooms || []).map((r) => (typeof r === 'string'
    ? { id: roomId(r), name: r }
    : { ...r, id: r.id || roomId(r.name), name: r.name || r.id }));
  c.calendars ??= [];
  c.server ??= {};
  return c;
}

// The first version had a "floorplan" widget, which the "house" widget
// (plans plus the 3D model) replaced. Configs copied from that version
// still name it, so show the bundled house instead of a missing widget.
function upgradeWidget(w) {
  if (w?.type !== 'floorplan') return w;
  console.log('homepage.yaml: "type: floorplan" is now "type: house"; showing the bundled plans and 3D model');
  const { floors: _old, ...rest } = w;
  return {
    ...rest,
    type: 'house',
    floors: [
      { name: 'Ground floor', plan: '/house/ground.svg' },
      { name: 'First floor', plan: '/house/first.svg' },
    ],
    model: { name: '3D', obj: '/house/house.obj', mtl: '/house/house.mtl' },
  };
}

export function publicConfig(c) {
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, c[k]]));
}

export function watchConfig(file, onChange) {
  let timer;
  // Watch the folder rather than the file: editors often replace the
  // file on save, which ends a file watch.
  watch(path.dirname(file), (_event, name) => {
    if (name !== path.basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        onChange(await loadConfig(file));
        console.log('Config reloaded');
      } catch (err) {
        console.error(`Config not reloaded: ${err.message}`);
      }
    }, 200);
  });
}

// Finds a room by id or name; unknown rooms keep a slug of what was given.
export function resolveRoom(config, value) {
  if (value == null || value === '') return null;
  const v = String(value);
  const room = config.rooms.find((r) => r.id === v || r.name.toLowerCase() === v.toLowerCase());
  return room ? room.id : roomId(v);
}

function roomId(s) {
  return slug(s).replace(/-/g, '_');
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const PALETTE = ['#4f8cff', '#f2994a', '#27ae60', '#bb6bd9', '#eb5757', '#2d9cdb'];
