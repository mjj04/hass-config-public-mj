// Small shared bits of household state: who is home, the meal plan, and
// free-text notes (a message board).

import { addDays, dayKey, weekKey } from '../lib/time.js';

export const routes = {
  // ----- Who's home (tap a person to switch) -----

  'GET /api/people': ({ store, config }) => {
    const presence = store.get('presence', {});
    return {
      people: config.people.map((p) => ({
        ...p,
        status: presence[p.id]?.status || 'home',
        since: presence[p.id]?.since || null,
      })),
    };
  },

  'POST /api/people/:id': async ({ store, config, params, body, emit, fail }) => {
    if (!config.people.some((p) => p.id === params.id)) fail(404, 'No such person');
    const status = body.status === 'away' ? 'away' : 'home';
    await store.update('presence', {}, (all) => ({
      ...all,
      [params.id]: { status, since: new Date().toISOString() },
    }));
    emit('people');
  },

  // ----- Meal plan, one line per day -----

  'GET /api/meals': ({ store, config, url }) => {
    const tz = config.timezone;
    const days = Math.min(Number(url.searchParams.get('days')) || 7, 31);
    const start = url.searchParams.get('from') === 'week' ? weekKey(new Date(), tz) : dayKey(new Date(), tz);
    const meals = store.get('meals', {});
    return {
      today: dayKey(new Date(), tz),
      days: Array.from({ length: days }, (_, i) => {
        const date = addDays(start, i);
        return { date, text: meals[date] || '' };
      }),
    };
  },

  'PUT /api/meals/:date': async ({ store, config, params, body, emit, fail }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) fail(400, 'Date must be YYYY-MM-DD');
    const text = String(body.text ?? '').trim().slice(0, 200);
    const oldest = addDays(dayKey(new Date(), config.timezone), -60);
    await store.update('meals', {}, (meals) => {
      const next = Object.fromEntries(Object.entries(meals).filter(([d]) => d >= oldest));
      if (text) next[params.date] = text; else delete next[params.date];
      return next;
    });
    emit('meals');
  },

  // ----- Notes / message board -----

  'GET /api/notes/:id': ({ store, params }) => store.get(`note:${params.id}`, { text: '', updatedAt: null }),

  'PUT /api/notes/:id': async ({ store, params, body, emit }) => {
    const note = { text: String(body.text ?? '').slice(0, 5000), updatedAt: new Date().toISOString() };
    await store.set(`note:${params.id}`, note);
    emit('notes');
    return note;
  },
};
