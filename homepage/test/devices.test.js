// Smart device tests: fake HTTP devices (generic, Shelly, Hue, WLED), a
// real MQTT broker for Zigbee2MQTT and Tasmota, and a custom adapter.

import { test, before, after } from 'node:test';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { startServer, eventually, wait } from './helpers.js';

let app, fake, broker, brokerServer, client;
const seen = { plug: false, shelly: false, hue: { on: false, bri: 254, reachable: true }, wled: { on: false, bri: 255 } };
const mqttIn = [];

before(async () => {
  // One fake server plays every HTTP device.
  fake = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    const send = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (url.pathname === '/plug/on') { seen.plug = true; return send({ ok: 1 }); }
    if (url.pathname === '/plug/off') { seen.plug = false; return send({ ok: 1 }); }
    if (url.pathname === '/plug/status') return send({ relay: { ison: seen.plug ? 'on' : 'off' }, watts: 12.5 });
    if (url.pathname === '/rpc/Switch.GetStatus') return send({ id: 0, output: seen.shelly, apower: seen.shelly ? 1800 : 0 });
    if (url.pathname === '/rpc/Switch.Set') { seen.shelly = url.searchParams.get('on') === 'true'; return send({ was_on: !seen.shelly }); }
    if (url.pathname === '/api/KEY/lights/3' && req.method === 'GET') return send({ state: seen.hue });
    if (url.pathname === '/api/KEY/lights/3/state' && req.method === 'PUT') {
      Object.assign(seen.hue, JSON.parse(body));
      return send([{ success: {} }]);
    }
    if (url.pathname === '/api/KEY/lights/9') return send([{ error: { type: 3, description: 'resource, /lights/9, not available' } }]);
    if (url.pathname === '/json/state') {
      if (req.method === 'POST') Object.assign(seen.wled, JSON.parse(body));
      return send(seen.wled);
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const host = `127.0.0.1:${fake.address().port}`;

  broker = await Aedes.createBroker();
  brokerServer = net.createServer(broker.handle);
  await new Promise((r) => brokerServer.listen(0, '127.0.0.1', r));
  const mqttUrl = `mqtt://127.0.0.1:${brokerServer.address().port}`;
  client = mqtt.connect(mqttUrl);
  await new Promise((r) => client.on('connect', r));
  client.subscribe(['zigbee2mqtt/#', 'cmnd/#']);
  client.on('message', (topic, buf) => mqttIn.push([topic, buf.toString()]));

  app = await startServer(`
timezone: Europe/London
rooms:
  - { id: kitchen, name: Kitchen }
  - Bedroom 1
mqtt:
  url: ${mqttUrl}
hue:
  bridge: ${host}
  key: KEY
devices_poll: 2
devices:
  - { name: Lamp, room: Bedroom 1, type: light, via: virtual }
  - { name: Fan, room: bedroom_1, type: fan, via: virtual }
  - { name: Thermo, room: kitchen, type: sensor, via: virtual, state: { temperature: 21.5 } }
  - name: Plug
    room: kitchen
    via:
      http:
        on: http://${host}/plug/on
        off: http://${host}/plug/off
        state: { url: 'http://${host}/plug/status', on: relay.ison, power: watts }
  - { name: Kettle, room: kitchen, via: { shelly: '${host}' } }
  - { name: Hue lamp, type: light, via: { hue: 3 } }
  - { name: Missing hue, type: light, via: { hue: 9 } }
  - { name: Strip, type: light, via: { wled: '${host}' } }
  - { name: Ceiling, room: kitchen, type: light, via: { zigbee2mqtt: Kitchen ceiling } }
  - { name: Radiator, type: climate, via: { zigbee2mqtt: TRV } }
  - { name: Sonoff, via: { tasmota: sonoff1 } }
  - { name: Custom, via: { adapter: fake, start: 7 } }
  - { name: Broken, via: { nonsense: 1 } }
  - { name: Lamp, room: kitchen, via: virtual }
scenes:
  - name: Bedtime
    actions:
      - { all: '*', set: off }
      - { device: lamp, set: { brightness: 10 } }
`, {
    'devices/fake.js': `
      export function create(def, via) {
        let level = via.start;
        return { read: async () => ({ on: level > 0, brightness: level }), set: async (c) => { level = c.on === false ? 0 : (c.brightness ?? 50); } };
      }`,
  });
});

after(async () => {
  await app?.stop();
  client?.end(true);
  await new Promise((r) => brokerServer?.close(r));
  broker?.close();
  fake?.close();
});

const device = async (id) => (await app.json('/api/devices')).body.devices.find((d) => d.id === id);
const cmd = (id, body) => app.json(`/api/devices/${id}`, { method: 'POST', body });

test('lists devices with rooms resolved and bad ones marked', async () => {
  const { body } = await app.json('/api/devices');
  const ids = body.devices.map((d) => d.id);
  assert.equal(ids.filter((i) => i === 'lamp').length, 1, 'duplicate id skipped');
  assert.equal((await device('lamp')).room, 'bedroom_1');
  assert.equal((await device('fan')).room, 'bedroom_1');
  const broken = await device('broken');
  assert.equal(broken.available, false);
  assert.match(broken.error, /Unknown device connection/);
  assert.ok(body.scenes.some((s) => s.id === 'all-off'));
  assert.equal(JSON.stringify(body).includes('KEY'), false, 'no secrets in the API');
});

test('virtual: toggle, brightness, sensors refuse commands', async () => {
  assert.equal((await cmd('lamp', { on: 'toggle' })).body.state.on, true);
  const r = await cmd('lamp', { brightness: 250 });
  assert.equal(r.body.state.brightness, 100);
  assert.equal((await cmd('thermo', { on: true })).status, 400);
  assert.equal((await device('thermo')).state.temperature, 21.5);
  assert.equal((await cmd('nope', { on: true })).status, 404);
  assert.equal((await cmd('lamp', {})).status, 400);
});

test('http: commands and polled state', async () => {
  await cmd('plug', { on: true });
  assert.equal(seen.plug, true);
  const d = await eventually(async () => { const x = await device('plug'); return x.state.power === 12.5 && x; });
  assert.equal(d.state.on, true);
});

test('shelly: switch and power', async () => {
  await cmd('kettle', { on: true });
  assert.equal(seen.shelly, true);
  await eventually(async () => (await device('kettle')).state.power === 1800);
});

test('hue: brightness scales to 254 and bridge errors show', async () => {
  await cmd('hue_lamp', { brightness: 50 });
  assert.equal(seen.hue.on, true);
  assert.equal(seen.hue.bri, 127);
  const missing = await device('missing_hue');
  assert.equal(missing.available, false);
  assert.match(missing.error, /not available/);
});

test('wled: on and brightness', async () => {
  await cmd('strip', { brightness: 100 });
  assert.deepEqual(seen.wled, { on: true, bri: 255 });
});

test('zigbee2mqtt: state in, commands out', async () => {
  client.publish('zigbee2mqtt/Kitchen ceiling', JSON.stringify({ state: 'ON', brightness: 127 }));
  await eventually(async () => (await device('ceiling')).state.brightness === 50);
  mqttIn.length = 0;
  await cmd('ceiling', { on: false });
  const sent = await eventually(() => mqttIn.find(([t]) => t === 'zigbee2mqtt/Kitchen ceiling/set'));
  assert.deepEqual(JSON.parse(sent[1]), { state: 'OFF' });

  client.publish('zigbee2mqtt/TRV', JSON.stringify({ local_temperature: 18.5, current_heating_setpoint: 19 }));
  await eventually(async () => (await device('radiator')).state.target === 19);
  await cmd('radiator', { target: 21.3 });
  const trv = await eventually(() => mqttIn.find(([t]) => t === 'zigbee2mqtt/TRV/set'));
  assert.deepEqual(JSON.parse(trv[1]), { current_heating_setpoint: 21.5 });

  client.publish('zigbee2mqtt/Kitchen ceiling/availability', JSON.stringify({ state: 'offline' }));
  await eventually(async () => (await device('ceiling')).available === false);
});

test('tasmota: power, sensor data and availability', async () => {
  client.publish('stat/sonoff1/POWER', 'ON');
  await eventually(async () => (await device('sonoff')).state.on === true);
  client.publish('tele/sonoff1/SENSOR', JSON.stringify({ ENERGY: { Power: 42 }, AM2301: { Temperature: 22.1, Humidity: 40 } }));
  await eventually(async () => (await device('sonoff')).state.power === 42);
  mqttIn.length = 0;
  await cmd('sonoff', { on: 'toggle' });
  const sent = await eventually(() => mqttIn.find(([t]) => t === 'cmnd/sonoff1/POWER'));
  assert.equal(sent[1], 'OFF');
});

test('custom adapter from config/devices', async () => {
  assert.equal((await device('custom')).state.brightness, 7);
  await cmd('custom', { brightness: 60 });
  await eventually(async () => (await device('custom')).state.brightness === 60);
});

test('room off and scenes (later actions win)', async () => {
  await cmd('lamp', { on: true });
  await cmd('fan', { on: true });
  const off = await app.json('/api/rooms/bedroom_1/off', { method: 'POST' });
  assert.equal(off.body.done, 2);
  assert.equal((await device('fan')).state.on, false);

  await cmd('fan', { on: true });
  const r = await app.json('/api/scenes/bedtime', { method: 'POST' });
  assert.ok(r.body.done > 3);
  // Broken and offline devices are reported, not fatal.
  assert.ok(r.body.failed.length >= 1);
  assert.equal((await device('fan')).state.on, false);
  const lamp = await device('lamp');
  assert.equal(lamp.state.on, true);
  assert.equal(lamp.state.brightness, 10);
  assert.equal((await app.json('/api/scenes/nope', { method: 'POST' })).status, 404);
});

test('devices survive a config reload', async () => {
  const file = path.join(app.dir, 'config', 'homepage.yaml');
  await appendFile(file, '\n# edited\n');
  await eventually(() => app.log().includes('Config reloaded'));
  await wait(300);
  assert.equal((await device('lamp')).state.brightness, 10, 'virtual state kept');
  client.publish('zigbee2mqtt/Kitchen ceiling', JSON.stringify({ state: 'ON', brightness: 254 }));
  await eventually(async () => (await device('ceiling')).state.brightness === 100);
});
