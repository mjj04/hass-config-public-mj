// Device controls grouped by room.
// Options: room (only this room), types (e.g. [light, switch])

import { deviceRow } from '/lib/device-ui.js';

export default function devices(el, opts, ctx) {
  const { h, api, on, room: findRoom } = ctx;
  const box = h('div');
  el.append(box);
  let pending = false;
  el.addEventListener('focusout', () => { if (pending) setTimeout(load); });

  async function load() {
    if (el.contains(document.activeElement) && document.activeElement.matches('input')) { pending = true; return; }
    pending = false;
    try {
      let { devices: list } = await api('/api/devices');
      if (opts.room) list = list.filter((d) => d.room === (findRoom(opts.room)?.id || opts.room));
      if (opts.types) list = list.filter((d) => opts.types.includes(d.type));
      const groups = new Map();
      for (const d of list) {
        const key = d.room || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }
      box.replaceChildren(
        ...[...groups].flatMap(([room, devs]) => [
          opts.room ? '' : h('div', { class: 'small muted', style: { margin: '12px 0 0', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.06em' } },
            room ? findRoom(room)?.name || room : 'Other'),
          ...devs.map((d) => deviceRow(ctx, d)),
        ]),
        list.length ? '' : h('p', { class: 'empty' }, 'No devices. Add them under devices: in homepage.yaml.'),
      );
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  on('devices', load);
}
