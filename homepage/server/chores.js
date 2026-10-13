// Chores with an owner, an optional room, and a repeat:
//   daily  - resets every morning
//   weekly - resets every Monday
//   once   - stays done
// "Done" is worked out from when it was last ticked, so nothing needs to
// run at midnight. The first time the app starts, chores listed under
// `chores:` in homepage.yaml are added; after that, manage them on screen.

import { randomUUID } from 'node:crypto';
import { dayKey, weekKey } from '../lib/time.js';

const KEY = 'chores';
const REPEATS = ['daily', 'weekly', 'once'];

export function isDone(chore, now, tz) {
  if (!chore.doneAt) return false;
  const at = new Date(chore.doneAt);
  if (chore.repeat === 'daily') return dayKey(at, tz) === dayKey(now, tz);
  if (chore.repeat === 'weekly') return weekKey(at, tz) === weekKey(now, tz);
  return true;
}

function clean(body, people, fail, partial = false) {
  const out = {};
  if (!partial || 'title' in body) {
    out.title = String(body.title ?? '').trim().slice(0, 120);
    if (!out.title) fail(400, 'Title is required');
  }
  if (!partial || 'person' in body) {
    out.person = body.person || null;
    if (out.person && !people.some((p) => p.id === out.person)) fail(400, `Unknown person ${out.person}`);
  }
  if (!partial || 'room' in body) out.room = body.room ? String(body.room).slice(0, 60) : null;
  if (!partial || 'repeat' in body) {
    out.repeat = body.repeat || 'daily';
    if (!REPEATS.includes(out.repeat)) fail(400, `Repeat must be one of ${REPEATS.join(', ')}`);
  }
  return out;
}

async function seeded(store, config) {
  if (store.get('choresSeeded', false)) return;
  const fail = (_s, m) => { throw new Error(m); };
  const initial = [];
  for (const c of config.chores || []) {
    try {
      initial.push({ id: randomUUID(), ...clean(c, config.people, fail), doneAt: null });
    } catch (err) {
      console.error(`Skipped chore "${c.title}" from config: ${err.message}`);
    }
  }
  await store.set(KEY, [...store.get(KEY, []), ...initial]);
  await store.set('choresSeeded', true);
}

function view(store, config) {
  const now = new Date();
  return store.get(KEY, []).map((c) => ({ ...c, done: isDone(c, now, config.timezone) }));
}

export const routes = {
  'GET /api/chores': async ({ store, config }) => {
    await seeded(store, config);
    return { chores: view(store, config) };
  },

  'POST /api/chores': async ({ store, config, body, emit, fail }) => {
    const chore = { id: randomUUID(), ...clean(body, config.people, fail), doneAt: null };
    await store.update(KEY, [], (list) => [...list, chore]);
    emit('chores');
    return chore;
  },

  'PATCH /api/chores/:id': async ({ store, config, params, body, emit, fail }) => {
    const changes = clean(body, config.people, fail, true);
    let found = false;
    await store.update(KEY, [], (list) => list.map((c) => {
      if (c.id !== params.id) return c;
      found = true;
      return { ...c, ...changes };
    }));
    if (!found) fail(404, 'No such chore');
    emit('chores');
  },

  // Body: { done: true|false, by: personId }
  'POST /api/chores/:id/done': async ({ store, config, params, body, emit, fail }) => {
    let found = false;
    await store.update(KEY, [], (list) => list.map((c) => {
      if (c.id !== params.id) return c;
      found = true;
      return body.done === false
        ? { ...c, doneAt: null, doneBy: null }
        : { ...c, doneAt: new Date().toISOString(), doneBy: body.by || c.person || null };
    }));
    if (!found) fail(404, 'No such chore');
    emit('chores');
    return { chores: view(store, config) };
  },

  'DELETE /api/chores/:id': async ({ store, params, emit }) => {
    await store.update(KEY, [], (list) => list.filter((c) => c.id !== params.id));
    emit('chores');
  },
};
