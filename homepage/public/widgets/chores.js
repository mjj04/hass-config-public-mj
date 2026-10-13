// Chores, one column per person plus "Anyone". Tap to tick off; daily
// chores reset each morning and weekly ones each Monday.
// Options: person (only show this person's column), room (only this room),
//          anyone (show the Anyone column, default true)

const REPEAT_TEXT = { daily: 'Every day', weekly: 'Every week', once: 'One-off' };

export function choreForm(ctx, chore = {}) {
  const { h, people, config } = ctx;
  const title = h('input', { class: 'field', name: 'title', placeholder: 'What needs doing?', value: chore.title || '', required: true, maxlength: 120 });
  const person = h('select', { class: 'field', name: 'person' },
    h('option', { value: '' }, 'Anyone'),
    people.map((p) => h('option', { value: p.id, selected: chore.person === p.id }, p.name)));
  const room = h('select', { class: 'field', name: 'room' },
    h('option', { value: '' }, 'No room'),
    config.rooms.map((r) => h('option', { value: r.id, selected: chore.room === r.id || chore.room === r.name }, r.name)));
  const repeat = h('select', { class: 'field', name: 'repeat' },
    Object.entries(REPEAT_TEXT).map(([v, t]) => h('option', { value: v, selected: (chore.repeat || 'daily') === v }, t)));
  const form = h('form', { onSubmit: (e) => e.preventDefault() }, title, person, room, repeat);
  return {
    form,
    value: () => ({ title: title.value, person: person.value || null, room: room.value || null, repeat: repeat.value }),
    focus: () => setTimeout(() => title.focus(), 50),
  };
}

export function editChore(ctx, chore, after) {
  const f = choreForm(ctx, chore);
  const isNew = !chore.id;
  ctx.dialog({
    title: isNew ? 'Add a chore' : 'Edit chore',
    body: f.form,
    actions: [
      !isNew && { label: 'Delete', danger: true, onClick: async () => { await ctx.api(`/api/chores/${chore.id}`, { method: 'DELETE' }); after?.(); } },
      { label: 'Cancel' },
      { label: isNew ? 'Add' : 'Save', primary: true, onClick: async () => {
        await ctx.api(isNew ? '/api/chores' : `/api/chores/${chore.id}`, { method: isNew ? 'POST' : 'PATCH', body: f.value() });
        after?.();
      } },
    ].filter(Boolean),
  });
  f.focus();
}

export function choreRow(ctx, c, after) {
  const { h, api, person } = ctx;
  const toggle = async () => {
    await api(`/api/chores/${c.id}/done`, { method: 'POST', body: { done: !c.done } });
    after?.();
  };
  const roomName = c.room ? ctx.room(c.room)?.name || c.room : null;
  const sub = [roomName, c.repeat !== 'daily' && REPEAT_TEXT[c.repeat]].filter(Boolean).join(' · ');
  const by = c.done && c.doneBy && c.doneBy !== c.person ? person(c.doneBy)?.name : null;
  return h('div', { class: `row${c.done ? ' done' : ''}` },
    h('button', { type: 'button', class: `check${c.done ? ' on' : ''}`, 'aria-label': `${c.title}: ${c.done ? 'done' : 'not done'}`, onClick: toggle }),
    h('div', { class: 'label', onClick: toggle },
      h('div', { class: 'strike' }, c.title),
      sub || by ? h('div', { class: 'small muted' }, [sub, by && `done by ${by}`].filter(Boolean).join(' · ')) : ''),
    h('button', { type: 'button', class: 'btn icon', 'aria-label': `Edit ${c.title}`, onClick: () => editChore(ctx, c, after) }, '⋯'));
}

export default function chores(el, opts, ctx) {
  const { h, api, people, on, every } = ctx;
  el.append(h('style', {}, `
    .chores { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 24px; align-items: start; }
    .chores-col h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 16px; }
    .chores-col h3 .n { margin-left: auto; font-size: 13px; color: var(--muted); font-weight: 600; }
    .chores-col .all-done { color: var(--ok); font-weight: 600; padding: 10px 0; }
  `));
  const box = h('div', { class: 'chores' });
  el.append(box);
  ctx.action('+', () => editChore(ctx, { person: opts.person || null, room: opts.room || null }, load), 'Add a chore');

  async function load() {
    try {
      let { chores: list } = await api('/api/chores');
      if (opts.room) {
        const want = ctx.room(opts.room)?.id || opts.room;
        list = list.filter((c) => (ctx.room(c.room)?.id || c.room) === want);
      }
      const columns = [
        ...people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
        ...(opts.anyone === false ? [] : [{ id: null, name: 'Anyone', color: 'var(--muted)' }]),
      ].filter((col) => (opts.person ? col.id === opts.person || (col.id === null && opts.anyone) : true));

      const cols = columns.map((col) => {
        const mine = list.filter((c) => (c.person || null) === col.id)
          .sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title));
        return { col, mine };
      }).filter(({ mine }) => opts.person || mine.length);

      box.replaceChildren(...cols.map(({ col, mine }) => {
        const done = mine.filter((c) => c.done).length;
        return h('div', { class: 'chores-col' },
          h('h3', {}, h('span', { class: 'dot', style: { background: col.color } }), col.name, h('span', { class: 'n' }, `${done}/${mine.length}`)),
          mine.length && done === mine.length ? h('div', { class: 'all-done' }, 'All done 🎉') : '',
          mine.map((c) => choreRow(ctx, c, load)));
      }));
      if (!cols.length) box.replaceChildren(h('p', { class: 'empty' }, 'No chores yet. Tap + to add one.'));
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  on('chores', load);
  every(60_000, load); // picks up the morning reset
}
