// Shared checklists (shopping, to-do, anything). A list is created the
// first time something is added to it, so any `list:` id in the config
// works.

import { randomUUID } from 'node:crypto';

const key = (list) => `list:${list}`;

function text(body, fail) {
  const t = String(body.text ?? '').trim();
  if (!t) fail(400, 'Text is required');
  return t.slice(0, 200);
}

export const routes = {
  'GET /api/lists/:list': ({ store, params }) => ({ items: store.get(key(params.list), []) }),

  'POST /api/lists/:list/items': async ({ store, params, body, emit, fail }) => {
    const item = { id: randomUUID(), text: text(body, fail), done: false, addedAt: new Date().toISOString() };
    await store.update(key(params.list), [], (items) => [item, ...items]);
    emit('lists');
    return item;
  },

  'PATCH /api/lists/:list/items/:id': async ({ store, params, body, emit, fail }) => {
    let found;
    await store.update(key(params.list), [], (items) => items.map((it) => {
      if (it.id !== params.id) return it;
      found = { ...it };
      if ('done' in body) {
        found.done = !!body.done;
        found.doneAt = found.done ? new Date().toISOString() : null;
      }
      if ('text' in body) found.text = text(body, fail);
      return found;
    }));
    if (!found) fail(404, 'No such item');
    emit('lists');
    return found;
  },

  'DELETE /api/lists/:list/items/:id': async ({ store, params, emit }) => {
    await store.update(key(params.list), [], (items) => items.filter((it) => it.id !== params.id));
    emit('lists');
  },

  'POST /api/lists/:list/clear-done': async ({ store, params, emit }) => {
    await store.update(key(params.list), [], (items) => items.filter((it) => !it.done));
    emit('lists');
  },
};
