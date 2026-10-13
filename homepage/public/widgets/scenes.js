// One-tap scenes from homepage.yaml (scenes:), plus "All off".
// Options: scenes (list of scene ids to show; default all)

export default function scenes(el, opts, { h, api, toast }) {
  el.append(h('style', {}, `
    .scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .scene-grid button { min-height: 84px; border: 0; border-radius: 16px; background: var(--chip); font-weight: 600; display: grid; place-items: center; gap: 4px; padding: 8px; }
    .scene-grid .i { font-size: 28px; line-height: 1; }
  `));
  const grid = h('div', { class: 'scene-grid' });
  el.append(grid);

  async function load() {
    try {
      const { scenes: list } = await api('/api/devices');
      const shown = opts.scenes ? list.filter((s) => opts.scenes.includes(s.id)) : list;
      grid.replaceChildren(...shown.map((s) => h('button', {
        type: 'button',
        onClick: async () => {
          try {
            const r = await api(`/api/scenes/${encodeURIComponent(s.id)}`, { method: 'POST' });
            toast(r.failed?.length ? r.failed.join('; ') : `${s.name} ✓`, { error: !!r.failed?.length });
          } catch (err) {
            toast(err.message, { error: true });
          }
        },
      }, h('span', { class: 'i', 'aria-hidden': 'true' }, s.icon), s.name)));
    } catch (err) {
      grid.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
}
