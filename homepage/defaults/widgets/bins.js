// Example of your own widget. Files in config/widgets/ are loaded as
// `type: <file name>` and override the built-in widgets of the same name.
//
// Bin collection days. Options:
//   bins: [{ name, color, next: 'YYYY-MM-DD', every: days }]
// `next` can be any past or future collection date; the widget counts on
// from it in steps of `every`.

export default function bins(el, opts, { h, fmt, every }) {
  const box = h('div');
  el.append(box);

  const draw = () => {
    const today = fmt.dayKey(new Date());
    const rows = (opts.bins || []).map((b) => {
      let next = b.next;
      const step = Number(b.every) || 7;
      while (next < today) next = fmt.addDays(next, step);
      return { ...b, next };
    }).sort((a, b) => (a.next < b.next ? -1 : 1));

    box.replaceChildren(...rows.map((b) => {
      const soon = b.next === today || b.next === fmt.addDays(today, 1);
      return h('div', { class: 'row' },
        h('span', { class: 'dot', style: { background: b.color || 'var(--accent)', width: '16px', height: '16px' } }),
        h('span', { class: 'label', style: { fontWeight: soon ? '700' : '400' } }, b.name),
        h('span', { style: { color: soon ? 'var(--warn)' : 'var(--muted)', fontWeight: soon ? '700' : '400' } },
          fmt.dayLabel(b.next, { weekday: 'short', day: 'numeric', month: 'short' })));
    }));
    if (!rows.length) box.replaceChildren(h('p', { class: 'empty' }, 'Add bins: to this widget in homepage.yaml.'));
  };
  draw();
  every(60 * 60_000, draw);
}
