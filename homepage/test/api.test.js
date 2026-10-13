// End-to-end tests: starts the real server with a temporary config and
// data folder, plus a fake Docker API, and talks to it over HTTP.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir, proc, docker, base;

const json = async (p, opts = {}) => {
  const res = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'homepage-test-'));

  // Fake Docker Engine API: one running, one stopped container.
  docker = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/containers/json')) {
      return res.end(JSON.stringify([
        { Id: 'a'.repeat(64), Names: ['/plex'], Image: 'plex', State: 'running', Status: 'Up 2 days (healthy)' },
        { Id: 'b'.repeat(64), Names: ['/old'], Image: 'old', State: 'exited', Status: 'Exited (0) 3 days ago' },
      ]));
    }
    if (req.url.startsWith(`/containers/${'a'.repeat(64)}/stats`)) {
      return res.end(JSON.stringify({
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
        memory_stats: { usage: 300 * 1024 * 1024, stats: { inactive_file: 100 * 1024 * 1024 } },
      }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => docker.listen(0, '127.0.0.1', r));

  const config = path.join(dir, 'config');
  await mkdir(path.join(config, 'widgets'), { recursive: true });

  // A daily recurring event, a two-day all-day event starting today, and
  // one long past.
  const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).replaceAll('-', '');
  await writeFile(path.join(dir, 'school.ics'), [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
    'BEGIN:VEVENT', 'UID:swim-1', 'DTSTART;TZID=Europe/London:20260901T170000',
    'DTEND;TZID=Europe/London:20260901T180000', 'RRULE:FREQ=DAILY', 'SUMMARY:Swimming',
    'LOCATION:Leisure centre', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:inset-1', `DTSTART;VALUE=DATE:${day(0)}`, `DTEND;VALUE=DATE:${day(2)}`,
    'SUMMARY:Inset days', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:old-1', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z',
    'SUMMARY:Long ago', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
  await writeFile(path.join(config, 'homepage.yaml'), `
title: Test House
timezone: Europe/London
people:
  - { id: a, name: Alex }
  - { id: b, name: Sam }
rooms: [Kitchen]
calendars:
  - name: School
    url: ${path.join(dir, 'school.ics')}
    color: '#ff0000'
chores:
  - { title: Seeded chore, person: a, room: Kitchen, repeat: daily }
  - { title: Bad chore, person: nobody }
server:
  name: Test server
  docker: http://127.0.0.1:${docker.address().port}
pages:
  - title: Home
    widgets:
      - { type: clock }
`);
  await writeFile(path.join(config, 'widgets', 'hello.js'), 'export default (el) => { el.textContent = "hi"; };');
  await writeFile(path.join(config, 'widgets', 'hello.server.js'),
    "export const routes = { 'GET /api/hello': ({ config }) => ({ hello: config.title }) };");

  const port = 18000 + Math.floor(Math.random() * 1000);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CONFIG_DIR: config, DATA_DIR: path.join(dir, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('Family homepage on')) resolve(); });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(async () => {
  proc?.kill();
  docker?.close();
  await rm(dir, { recursive: true, force: true });
});

test('config hides server-only settings', async () => {
  const { body } = await json('/api/config');
  assert.equal(body.title, 'Test House');
  assert.equal(body.calendars, undefined);
  assert.equal(body.server, undefined);
  assert.equal(body.pages[0].widgets[0].w, 4);
});

test('chores: seeded from config, toggled, reset rules', async () => {
  let { body } = await json('/api/chores');
  assert.deepEqual(body.chores.map((c) => c.title), ['Seeded chore']); // bad one skipped
  const id = body.chores[0].id;

  ({ body } = await json(`/api/chores/${id}/done`, { method: 'POST', body: { done: true } }));
  assert.equal(body.chores[0].done, true);
  assert.equal(body.chores[0].doneBy, 'a');

  const added = await json('/api/chores', { method: 'POST', body: { title: 'Weekly', repeat: 'weekly' } });
  assert.equal(added.body.person, null);
  assert.equal((await json('/api/chores', { method: 'POST', body: { title: 'x', repeat: 'hourly' } })).status, 400);
  assert.equal((await json('/api/chores', { method: 'POST', body: { title: '' } })).status, 400);

  await json(`/api/chores/${added.body.id}`, { method: 'PATCH', body: { room: 'Kitchen' } });
  await json(`/api/chores/${added.body.id}`, { method: 'DELETE' });
  ({ body } = await json('/api/chores'));
  assert.equal(body.chores.length, 1);
});

test('chore repeat logic', async () => {
  const { isDone } = await import('../server/chores.js');
  const tz = 'Europe/London';
  const mon = new Date('2026-10-12T09:00:00Z');
  const sun = new Date('2026-10-18T20:00:00Z');
  const nextMon = new Date('2026-10-19T07:00:00Z');
  assert.equal(isDone({ repeat: 'daily', doneAt: mon.toISOString() }, new Date('2026-10-12T22:30:00Z'), tz), true);
  // 23:30 UTC on the 12th is already the 13th in London (BST).
  assert.equal(isDone({ repeat: 'daily', doneAt: mon.toISOString() }, new Date('2026-10-12T23:30:00Z'), tz), false);
  assert.equal(isDone({ repeat: 'weekly', doneAt: mon.toISOString() }, sun, tz), true);
  assert.equal(isDone({ repeat: 'weekly', doneAt: mon.toISOString() }, nextMon, tz), false);
  assert.equal(isDone({ repeat: 'once', doneAt: mon.toISOString() }, nextMon, tz), true);
});

test('lists: add, tick, clear, delete', async () => {
  const a = await json('/api/lists/shopping/items', { method: 'POST', body: { text: 'Milk' } });
  const b = await json('/api/lists/shopping/items', { method: 'POST', body: { text: 'Bread' } });
  assert.equal((await json('/api/lists/shopping/items', { method: 'POST', body: { text: '  ' } })).status, 400);
  await json(`/api/lists/shopping/items/${a.body.id}`, { method: 'PATCH', body: { done: true } });
  await json('/api/lists/shopping/clear-done', { method: 'POST' });
  let { body } = await json('/api/lists/shopping');
  assert.deepEqual(body.items.map((i) => i.text), ['Bread']);
  await json(`/api/lists/shopping/items/${b.body.id}`, { method: 'DELETE' });
  ({ body } = await json('/api/lists/shopping'));
  assert.equal(body.items.length, 0);
});

test('people, meals and notes', async () => {
  await json('/api/people/b', { method: 'POST', body: { status: 'away' } });
  let { body } = await json('/api/people');
  assert.equal(body.people.find((p) => p.id === 'b').status, 'away');
  assert.equal((await json('/api/people/zz', { method: 'POST', body: {} })).status, 404);

  await json('/api/meals/2099-01-01', { method: 'PUT', body: { text: 'Pizza' } });
  assert.equal((await json('/api/meals/tomorrow', { method: 'PUT', body: { text: 'x' } })).status, 400);
  ({ body } = await json('/api/meals?days=3'));
  assert.equal(body.days.length, 3);

  await json('/api/notes/board', { method: 'PUT', body: { text: 'Back at 6' } });
  ({ body } = await json('/api/notes/board'));
  assert.equal(body.text, 'Back at 6');
});

test('calendar expands recurring events from an ICS file', async () => {
  const { body } = await json('/api/calendar?days=3');
  assert.deepEqual(body.errors, []);
  const swims = body.events.filter((e) => e.title === 'Swimming');
  assert.equal(swims.length, 3);
  assert.equal(swims[0].location, 'Leisure centre');
  assert.equal(swims[0].color, '#ff0000');
  const inset = body.events.find((e) => e.title === 'Inset days');
  assert.equal(inset.allDay, true);
  assert.equal(inset.start, body.today);
  assert.equal(inset.end.replaceAll('-', '') - inset.start.replaceAll('-', '') >= 1, true);
  assert.ok(!body.events.some((e) => e.title === 'Long ago'));
});

test('system reads host stats and the Docker API', async () => {
  const { body } = await json('/api/system');
  assert.equal(body.name, 'Test server');
  assert.ok(body.host.memory.total > 0);
  assert.ok(body.host.disks[0].total > 0);
  assert.equal(body.docker.available, true);
  const [plex, old] = body.docker.containers;
  assert.equal(plex.name, 'plex');
  assert.equal(plex.health, 'healthy');
  assert.equal(plex.cpu, 40); // 1000/10000 * 4 cpus
  assert.equal(plex.memUsed, 200 * 1024 * 1024);
  assert.equal(old.state, 'exited');
});

test('custom widgets from config/widgets', async () => {
  const front = await fetch(`${base}/widgets/hello.js`);
  assert.equal(front.status, 200);
  assert.match(await front.text(), /hi/);
  assert.equal((await fetch(`${base}/widgets/hello.server.js`)).status, 404);
  assert.deepEqual((await json('/api/hello')).body, { hello: 'Test House' });
  assert.equal((await fetch(`${base}/widgets/clock.js`)).status, 200);
});

test('static files stay inside their folders', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/three/build/three.module.js`)).status, 200);
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/widgets/..%2f..%2fserver.js', '/assets/../homepage.yaml',
    '/vendor/three/package.json', '/vendor/three/build/..%2f..%2f..%2fserver.js']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
});

test('live events fire on change', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  let text = '';
  const read = (async () => {
    while (!text.includes('"topic":"lists"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  await json('/api/lists/todo/items', { method: 'POST', body: { text: 'Fix gate' } });
  await Promise.race([read, new Promise((_, rej) => setTimeout(() => rej(new Error('no event')), 2000))]);
  ctrl.abort();
  assert.match(text, /event: hello/);
  assert.match(text, /"topic":"lists"/);
});
