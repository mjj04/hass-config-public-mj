// Device manager: builds a connection for each device in homepage.yaml,
// keeps its latest state, polls the ones that need polling, and runs
// commands, room "all off" and scenes.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILT_IN, fetchJson } from './adapters.js';
import { broker } from './broker.js';
import { resolveRoom, slug } from '../config.js';

const SWITCHABLE = ['light', 'switch', 'fan'];
const TYPES = ['light', 'switch', 'fan', 'sensor', 'climate', 'cover'];
const FIELDS = ['on', 'brightness', 'temperature', 'humidity', 'target', 'position', 'power', 'battery'];

class DeviceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function normalise(raw, config) {
  const id = raw.id || slug(raw.name).replace(/-/g, '_');
  if (!id) throw new Error('Every device needs a name or id');
  const type = raw.type || 'switch';
  if (!TYPES.includes(type)) throw new Error(`${id}: type must be one of ${TYPES.join(', ')}`);
  return {
    ...raw,
    id,
    name: raw.name || id,
    type,
    room: raw.room ? resolveRoom(config, raw.room) : null,
    all_off: raw.all_off ?? SWITCHABLE.includes(type),
  };
}

function viaKind(via) {
  if (via == null || via === 'virtual') return ['virtual', {}];
  if (typeof via === 'string') return [via, {}];
  const kind = ['adapter', ...Object.keys(BUILT_IN)].find((k) => k in via);
  if (!kind) throw new Error(`Unknown device connection (${Object.keys(via).join(', ')})`);
  return [kind, via];
}

export function createDeviceManager({ store, emit, configDir }) {
  let entries = new Map();
  let scenes = [];
  let timer = null;
  let emitTimer = null;
  let generation = 0;

  const changed = () => {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => emit('devices'), 80);
  };

  async function build(def, config) {
    const [kind, via] = viaKind(def.via);
    const env = { config, store, broker, fetchJson };
    if (kind === 'adapter') {
      // Your own connection: config/devices/<name>.js exporting create().
      const file = path.join(configDir, 'devices', `${path.basename(String(via.adapter))}.js`);
      const mod = await import(pathToFileURL(file).href);
      return mod.create(def, via, env);
    }
    if (!BUILT_IN[kind]) throw new Error(`Unknown device connection "${kind}"`);
    return BUILT_IN[kind](def, via, env);
  }

  function apply(entry, partial = {}, meta = {}) {
    let diff = false;
    const { available, ...rest } = partial;
    for (const k of FIELDS) {
      if (rest[k] === undefined || Number.isNaN(rest[k])) continue;
      if (entry.state[k] !== rest[k]) { entry.state[k] = rest[k]; diff = true; }
    }
    const avail = meta.available ?? available ?? true;
    if (entry.available !== avail || entry.error) { entry.available = avail; entry.error = null; diff = true; }
    if (diff) { entry.updatedAt = new Date().toISOString(); changed(); }
  }

  async function poll(entry) {
    if (!entry.adapter?.read) return;
    try {
      const s = await entry.adapter.read();
      if (s) apply(entry, s);
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'not responding' : err.message;
      if (entry.available || entry.error !== msg) {
        entry.available = false;
        entry.error = msg;
        changed();
      }
    }
  }

  const pollAll = () => Promise.all([...entries.values()].map(poll));

  function view(e) {
    const { id, name, room, type, icon, dimmable } = e.def;
    return {
      id, name, room, type, icon: icon || null,
      dimmable: type === 'light' && dimmable !== false,
      state: e.state, available: e.available, error: e.error, updatedAt: e.updatedAt,
    };
  }

  async function command(id, body = {}) {
    const e = entries.get(id);
    if (!e) throw new DeviceError(404, `No device "${id}"`);
    if (!e.adapter) throw new DeviceError(503, `${e.def.name}: ${e.error}`);
    if (e.def.type === 'sensor') throw new DeviceError(400, `${e.def.name} is a sensor`);

    const ch = {};
    if ('on' in body) ch.on = body.on === 'toggle' ? !e.state.on : !!body.on;
    if (body.brightness != null) {
      ch.brightness = Math.min(100, Math.max(1, Math.round(Number(body.brightness))));
      if (!('on' in ch)) ch.on = true;
    }
    if (body.target != null) ch.target = Math.min(30, Math.max(5, Math.round(Number(body.target) * 2) / 2));
    if (body.position != null) ch.position = Math.min(100, Math.max(0, Math.round(Number(body.position))));
    if (body.command) {
      if (!['open', 'close', 'stop'].includes(body.command)) throw new DeviceError(400, 'command must be open, close or stop');
      ch.command = body.command;
    }
    if (!Object.keys(ch).length || Object.values(ch).some((v) => Number.isNaN(v))) throw new DeviceError(400, 'Nothing to change');

    try {
      await e.adapter.set(ch);
    } catch (err) {
      throw new DeviceError(502, `${e.def.name}: ${err.name === 'TimeoutError' ? 'not responding' : err.message}`);
    }
    // Show the change straight away, then confirm with the device.
    const optimistic = { ...ch };
    if (ch.command && ch.command !== 'stop') optimistic.position = ch.command === 'open' ? 100 : 0;
    delete optimistic.command;
    apply(e, optimistic);
    if (e.adapter.read) setTimeout(() => poll(e), 400);
    return view(e);
  }

  // Runs commands, collecting failures instead of stopping at the first.
  async function many(list) {
    const results = await Promise.allSettled(list.map(([id, body]) => command(id, body)));
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    return { done: results.length - failed.length, failed };
  }

  const asBody = (set) => (typeof set === 'string' ? { on: set === 'toggle' ? 'toggle' : set === 'on' } : set || {});

  return {
    async configure(config) {
      const gen = ++generation;
      clearInterval(timer);
      for (const e of entries.values()) { try { e.adapter?.stop?.(); } catch { /* ignore */ } }
      broker.reset();

      const next = new Map();
      for (const raw of config.devices || []) {
        let def;
        try { def = normalise(raw, config); } catch (err) { console.error(`Device skipped: ${err.message}`); continue; }
        if (next.has(def.id)) { console.error(`Device skipped: duplicate id "${def.id}"`); continue; }
        const entry = { def, adapter: null, state: {}, available: true, error: null, updatedAt: null };
        try {
          entry.adapter = await build(def, config);
        } catch (err) {
          entry.available = false;
          entry.error = err.message;
          console.error(`Device ${def.id}: ${err.message}`);
        }
        next.set(def.id, entry);
      }
      if (gen !== generation) return; // a newer config arrived meanwhile
      entries = next;
      scenes = (config.scenes || []).map((s, i) => ({
        id: s.id || slug(s.name) || `scene${i + 1}`, name: s.name || `Scene ${i + 1}`, icon: s.icon || '✨', actions: s.actions || [],
      }));
      // Always available: everything with all_off (lights, switches, fans) off.
      if (!scenes.some((s) => s.id === 'all-off')) {
        scenes.push({ id: 'all-off', name: 'All off', icon: '⏻', actions: [{ all: '*', set: 'off' }] });
      }
      for (const e of entries.values()) {
        try { e.adapter?.subscribe?.((partial, meta) => apply(e, partial, meta)); } catch (err) { e.error = err.message; }
      }
      broker.prune();
      await pollAll();
      timer = setInterval(pollAll, Math.max(2, Number(config.devices_poll) || 10) * 1000);
      timer.unref?.();
      changed();
    },

    list() {
      return {
        devices: [...entries.values()].map(view),
        scenes: scenes.map(({ id, name, icon }) => ({ id, name, icon })),
      };
    },

    command,

    roomOff(room) {
      const targets = [...entries.values()].filter((e) => e.def.room === room && e.def.all_off && e.state.on !== false);
      return many(targets.map((e) => [e.def.id, { on: false }]));
    },

    async runScene(id) {
      const scene = scenes.find((s) => s.id === id);
      if (!scene) throw new DeviceError(404, `No scene "${id}"`);
      // Later actions win, so "everything off, then the landing light
      // at 15%" leaves the landing light on.
      const plan = new Map();
      for (const a of scene.actions) {
        const body = asBody(a.set);
        let targets = [];
        if (a.device) targets = [entries.get(a.device)].filter(Boolean);
        else if (a.room) targets = [...entries.values()].filter((e) => e.def.room === a.room && (!a.type || e.def.type === a.type));
        else if (a.all) targets = [...entries.values()].filter((e) => (a.all === '*' ? e.def.all_off : e.def.type === a.all));
        targets = targets.filter((e) => e.def.type !== 'sensor');
        for (const e of targets) plan.set(e.def.id, body);
      }
      return many([...plan]);
    },

    stop() {
      clearInterval(timer);
      broker.close();
    },
  };
}
