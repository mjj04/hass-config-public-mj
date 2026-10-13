// Built-in device connections. Each one turns a device's `via:` block
// into an object with:
//   read()          -> Promise<state>     (optional; polled; may include available: false)
//   subscribe(fn)   -> pushes fn(state, { available })   (optional)
//   set(changes)    -> Promise            (on, brightness, target, position, command)
//   stop()          (optional)
// State uses: on, brightness (0-100), temperature, humidity, target,
// position (0-100), power (W), battery (%).

const pct = (v, max) => (v == null ? undefined : Math.round((Number(v) / max) * 100));
const raw = (p, max) => Math.max(1, Math.round((p / 100) * max));

export async function fetchJson(url, { method = 'GET', body, headers = {}, timeout = 5_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: body && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ---------- virtual: state lives in the homepage (demo, or manual things) ----------

export function virtual(def, via, { store }) {
  const key = `device:${def.id}`;
  const initial = {
    ...(['light', 'switch', 'fan'].includes(def.type) ? { on: false } : {}),
    ...(def.type === 'light' && def.dimmable !== false ? { brightness: 100 } : {}),
    ...(def.type === 'cover' ? { position: 100 } : {}),
    ...(def.state || via.state || {}),
  };
  return {
    read: () => ({ ...initial, ...store.get(key, {}) }),
    async set(changes) {
      const next = { ...changes };
      if (next.command) {
        if (next.command !== 'stop') next.position = next.command === 'open' ? 100 : 0;
        delete next.command;
      }
      await store.update(key, {}, (s) => ({ ...s, ...next }));
    },
  };
}

// ---------- http: any device with a web API ----------
// via: { http: { on, off, brightness, target, state: { url, on, brightness, temperature, ... } } }
// Requests are a URL or { url, method, body, headers }; {{value}} is replaced.
// state.<field> is a dotted path into the JSON reply.

function dig(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function truthy(v, onValue) {
  if (onValue !== undefined) return v === onValue || String(v) === String(onValue);
  if (typeof v === 'string') return ['on', 'true', '1', 'open'].includes(v.toLowerCase());
  return !!v;
}

export function http(def, via) {
  const spec = via.http || {};
  const call = (req, value) => {
    if (!req) throw new Error(`${def.name}: no http request set for this action`);
    const r = typeof req === 'string' ? { url: req } : req;
    const sub = (s) => (typeof s === 'string' ? s.replaceAll('{{value}}', String(value)) : s);
    // In a JSON body, "{{value}}" becomes the bare number.
    const body = r.body && typeof r.body === 'object'
      ? JSON.parse(JSON.stringify(r.body).replaceAll('"{{value}}"', JSON.stringify(value ?? null)).replaceAll('{{value}}', String(value)))
      : sub(r.body);
    return fetchJson(sub(r.url), { method: r.method || (body ? 'POST' : 'GET'), body, headers: r.headers });
  };
  return {
    read: spec.state ? async () => {
      const s = spec.state;
      const data = await fetchJson(s.url, { headers: s.headers });
      const out = {};
      for (const field of ['on', 'brightness', 'temperature', 'humidity', 'target', 'position', 'power', 'battery']) {
        if (s[field] == null) continue;
        const v = dig(data, s[field]);
        out[field] = field === 'on' ? truthy(v, s.on_value) : Number(v);
      }
      return out;
    } : undefined,
    async set(ch) {
      if ('on' in ch && !('brightness' in ch && spec.brightness)) await call(ch.on ? spec.on : spec.off);
      if ('brightness' in ch) await call(spec.brightness || spec.on, ch.brightness);
      if ('target' in ch) await call(spec.target, ch.target);
      if ('position' in ch) await call(spec.position, ch.position);
      if (ch.command) await call(spec[ch.command]);
    },
  };
}

// ---------- Shelly (local HTTP API) ----------
// via: { shelly: 192.168.86.50, channel: 0, gen: 2 }   gen 1 for older devices

export function shelly(def, via) {
  const host = `http://${via.shelly}`;
  const ch = via.channel ?? 0;
  const light = def.type === 'light';
  if ((via.gen ?? 2) === 1) {
    const base = `${host}/${light ? 'light' : 'relay'}/${ch}`;
    return {
      async read() {
        const s = await fetchJson(base);
        return { on: !!s.ison, brightness: s.brightness };
      },
      async set(c) {
        const q = new URLSearchParams();
        if ('on' in c) q.set('turn', c.on ? 'on' : 'off');
        if (c.brightness != null) q.set('brightness', c.brightness);
        await fetchJson(`${base}?${q}`);
      },
    };
  }
  const comp = light ? 'Light' : 'Switch';
  return {
    async read() {
      const s = await fetchJson(`${host}/rpc/${comp}.GetStatus?id=${ch}`);
      return { on: !!s.output, brightness: s.brightness, power: s.apower, temperature: def.type === 'sensor' ? s.temperature?.tC : undefined };
    },
    async set(c) {
      const q = new URLSearchParams({ id: ch });
      if ('on' in c) q.set('on', c.on);
      if (c.brightness != null) q.set('brightness', c.brightness);
      await fetchJson(`${host}/rpc/${comp}.Set?${q}`);
    },
  };
}

// ---------- Philips Hue bridge ----------
// Top level: hue: { bridge: 192.168.86.x, key: <app key> }
// via: { hue: 3 } for a light, or { hue: 1, group: true } for a room/zone

export function hue(def, via, { config }) {
  if (!config.hue?.bridge || !config.hue?.key) throw new Error('Set hue.bridge and hue.key in homepage.yaml');
  const base = `http://${config.hue.bridge}/api/${config.hue.key}/${via.group ? 'groups' : 'lights'}/${via.hue}`;
  const check = (r) => {
    const err = Array.isArray(r) && r.find((x) => x.error)?.error;
    if (err) throw new Error(`Hue: ${err.description}`);
    return r;
  };
  return {
    async read() {
      const r = check(await fetchJson(base));
      if (via.group) return { on: !!r.state?.any_on, brightness: pct(r.action?.bri, 254) };
      return { on: !!r.state?.on, brightness: pct(r.state?.bri, 254), available: r.state?.reachable !== false };
    },
    async set(c) {
      const body = {};
      if ('on' in c) body.on = c.on;
      if (c.brightness != null) body.bri = raw(c.brightness, 254);
      check(await fetchJson(`${base}/${via.group ? 'action' : 'state'}`, { method: 'PUT', body }));
    },
  };
}

// ---------- WLED ----------
// via: { wled: 192.168.86.60 }

export function wled(def, via) {
  const url = `http://${via.wled}/json/state`;
  return {
    async read() {
      const s = await fetchJson(url);
      return { on: !!s.on, brightness: pct(s.bri, 255) };
    },
    async set(c) {
      const body = {};
      if ('on' in c) body.on = c.on;
      if (c.brightness != null) body.bri = raw(c.brightness, 255);
      await fetchJson(url, { method: 'POST', body });
    },
  };
}

// ---------- Zigbee2MQTT ----------
// via: { zigbee2mqtt: Friendly name }   (base topic: mqtt.zigbee2mqtt_base)

function fromZ2M(j) {
  return {
    on: typeof j.state === 'string' && ['ON', 'OFF'].includes(j.state) ? j.state === 'ON' : undefined,
    brightness: pct(j.brightness, 254),
    temperature: j.temperature ?? j.local_temperature,
    humidity: j.humidity,
    target: j.current_heating_setpoint ?? j.occupied_heating_setpoint,
    position: j.position,
    power: j.power,
    battery: j.battery,
  };
}

export function zigbee2mqtt(def, via, { config, broker }) {
  const b = broker.use(config.mqtt);
  const topic = `${config.mqtt.zigbee2mqtt_base || 'zigbee2mqtt'}/${via.zigbee2mqtt}`;
  return {
    subscribe(push) {
      b.subscribe(topic, (t) => push(fromZ2M(JSON.parse(t))));
      b.subscribe(`${topic}/availability`, (t) => push({}, { available: /online/i.test(t) }));
      if (def.type !== 'sensor') b.onConnect(() => b.publish(`${topic}/get`, { state: '' }).catch(() => {}));
    },
    async set(c) {
      const p = {};
      if ('on' in c) p.state = c.on ? 'ON' : 'OFF';
      if (c.brightness != null) p.brightness = raw(c.brightness, 254);
      if (c.target != null) p.current_heating_setpoint = c.target;
      if (c.position != null) p.position = c.position;
      if (c.command) p.state = c.command.toUpperCase();
      await b.publish(`${topic}/set`, p);
    },
  };
}

// ---------- Tasmota ----------
// via: { tasmota: topic }

function fromTasmota(j) {
  const out = {};
  const power = j.POWER ?? j.POWER1;
  if (power != null) out.on = power === 'ON';
  if (j.Dimmer != null) out.brightness = j.Dimmer;
  const sns = j.StatusSNS || j;
  if (sns.ENERGY?.Power != null) out.power = sns.ENERGY.Power;
  for (const v of Object.values(sns)) {
    if (v && typeof v === 'object' && 'Temperature' in v) {
      out.temperature = v.Temperature;
      if ('Humidity' in v) out.humidity = v.Humidity;
    }
  }
  return out;
}

export function tasmota(def, via, { config, broker }) {
  const b = broker.use(config.mqtt);
  const t = via.tasmota;
  return {
    subscribe(push) {
      for (const topic of [`stat/${t}/RESULT`, `tele/${t}/STATE`, `tele/${t}/SENSOR`, `stat/${t}/STATUS10`]) {
        b.subscribe(topic, (x) => push(fromTasmota(JSON.parse(x))));
      }
      b.subscribe(`stat/${t}/POWER`, (x) => push({ on: x === 'ON' }));
      b.subscribe(`tele/${t}/LWT`, (x) => push({}, { available: x === 'Online' }));
      b.onConnect(() => {
        b.publish(`cmnd/${t}/STATE`, '').catch(() => {});
        b.publish(`cmnd/${t}/STATUS`, '10').catch(() => {});
      });
    },
    async set(c) {
      if ('on' in c) await b.publish(`cmnd/${t}/POWER`, c.on ? 'ON' : 'OFF');
      if (c.brightness != null) await b.publish(`cmnd/${t}/Dimmer`, String(c.brightness));
    },
  };
}

// ---------- plain MQTT ----------
// via: { mqtt: { state_topic, command_topic, payload_on: ON, payload_off: OFF,
//                brightness_command_topic } }
// A JSON state payload may carry state/on, brightness, temperature, humidity.

export function mqttDevice(def, via, { config, broker }) {
  const b = broker.use(config.mqtt);
  const o = { payload_on: 'ON', payload_off: 'OFF', ...via.mqtt };
  return {
    subscribe(push) {
      if (!o.state_topic) return;
      b.subscribe(o.state_topic, (text) => {
        let j;
        try { j = JSON.parse(text); } catch { j = text; }
        if (j && typeof j === 'object') {
          const s = j.state ?? j.on;
          push({
            on: s == null ? undefined : s === true || s === o.payload_on,
            brightness: j.brightness, temperature: j.temperature, humidity: j.humidity, power: j.power,
          });
        } else if (def.type === 'sensor' && !Number.isNaN(Number(j))) {
          push({ temperature: Number(j) });
        } else {
          push({ on: String(j) === o.payload_on ? true : String(j) === o.payload_off ? false : undefined });
        }
      });
    },
    async set(c) {
      if (!o.command_topic) throw new Error(`${def.name}: no command_topic`);
      if ('on' in c) await b.publish(o.command_topic, c.on ? o.payload_on : o.payload_off);
      if (c.brightness != null && o.brightness_command_topic) await b.publish(o.brightness_command_topic, String(c.brightness));
    },
  };
}

export const BUILT_IN = { virtual, http, shelly, hue, wled, zigbee2mqtt, tasmota, mqtt: mqttDevice };
