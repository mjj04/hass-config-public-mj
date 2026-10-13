// Floor plans of the house with a badge on each room showing chores still
// to do there. Tap a room to see and tick off its chores.
// Options: floors: [{ name, image, rooms: [{ name, x, y }] }]
//   x / y are percentages across and down the image.

import { choreRow, editChore } from './chores.js';

export default function floorplan(el, opts, ctx) {
  const { h, api, on, every } = ctx;
  el.append(h('style', {}, `
    .fp { display: flex; gap: 16px; height: 100%; justify-content: center; flex-wrap: wrap; }
    .fp figure { margin: 0; flex: 1 1 240px; min-height: 0; display: flex; flex-direction: column; align-items: center; }
    .fp figcaption { font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    /* The stage is a size container so the plan can fit both ways. */
    .fp .stage { flex: 1; width: 100%; min-height: 320px; container-type: size; display: flex; justify-content: center; }
    .fp .plan { position: relative; aspect-ratio: var(--ar, 1); width: min(100cqw, calc(100cqh * var(--ar, 1))); }
    .fp img { display: block; width: 100%; height: 100%; }
    .fp .pin { position: absolute; transform: translate(-50%, -50%); min-height: 32px; padding: 0 12px; border: 0; border-radius: 99px; font-size: 13px; font-weight: 700; background: var(--card); box-shadow: 0 1px 4px rgba(0,0,0,.25); white-space: nowrap; }
    .fp .pin.todo { background: var(--warn); color: #1b1300; }
    .fp .pin.clear { color: var(--ok); }
  `));
  const box = h('div', { class: 'fp' });
  el.append(box);
  const floors = opts.floors || [];

  function openRoom(room, chores) {
    const body = h('div');
    const draw = (list) => body.replaceChildren(
      ...list.map((c) => choreRow(ctx, c, refresh)),
      list.length ? '' : h('p', { class: 'empty' }, 'No chores for this room.'),
    );
    const refresh = async () => {
      const { chores: all } = await api('/api/chores');
      draw(all.filter((c) => c.room === room));
      load();
    };
    draw(chores);
    ctx.dialog({
      title: room,
      body,
      actions: [
        { label: 'Add chore', onClick: () => { editChore(ctx, { room }, load); } },
        { label: 'Close', primary: true },
      ],
    });
  }

  async function load() {
    let chores = [];
    try { ({ chores } = await api('/api/chores')); } catch { /* plans still draw */ }
    box.replaceChildren(...floors.map((f) => h('figure', {},
      f.name ? h('figcaption', {}, f.name) : '',
      h('div', { class: 'stage' }, h('div', { class: 'plan' },
        h('img', {
          src: f.image,
          alt: `${f.name || 'Floor'} plan`,
          onLoad: (e) => e.target.parentNode.style.setProperty('--ar', e.target.naturalWidth / e.target.naturalHeight || 1),
        }),
        (f.rooms || []).map((r) => {
          const mine = chores.filter((c) => c.room === r.name);
          const open = mine.filter((c) => !c.done).length;
          return h('button', {
            type: 'button',
            class: `pin ${open ? 'todo' : mine.length ? 'clear' : ''}`,
            style: { left: `${r.x}%`, top: `${r.y}%` },
            'aria-label': `${r.name}: ${open} chores to do`,
            onClick: () => openRoom(r.name, mine),
          }, open ? `${open} to do` : mine.length ? '✓' : '+');
        }))))));
    if (!floors.length) box.replaceChildren(h('p', { class: 'empty' }, 'Add floors: to this widget in homepage.yaml.'));
  }
  load();
  on('chores', load);
  every(60_000, load);
}
