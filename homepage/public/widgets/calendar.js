// Agenda of upcoming events from the calendars in homepage.yaml.
// Options: days (default 7), calendars (list of names to show; default all)

export default function calendar(el, opts, { h, api, fmt, every }) {
  el.append(h('style', {}, `
    .cal-day { margin: 14px 0 4px; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .cal-day:first-of-type { margin-top: 0; }
    .cal-day.today { color: var(--accent); }
    .cal-ev { display: flex; gap: 12px; align-items: baseline; padding: 6px 0; }
    .cal-ev .t { flex: none; width: 4.6em; font-variant-numeric: tabular-nums; color: var(--muted); }
    .cal-ev .dot { transform: translateY(-1px); }
    .cal-ev .label { font-weight: 500; }
  `));
  const box = h('div');
  el.append(box);

  async function load() {
    try {
      const { today, events, errors } = await api(`/api/calendar?days=${opts.days || 7}`);
      const shown = opts.calendars ? events.filter((e) => opts.calendars.includes(e.calendar)) : events;
      const horizon = fmt.addDays(today, (opts.days || 7) - 1);
      const byDay = new Map();
      for (const ev of shown) {
        // Multi-day all-day events appear on each day they cover.
        // All-day end dates are exclusive. Anything already under way shows today.
        const start = ev.allDay ? ev.start : fmt.dayKey(new Date(ev.start));
        const first = start < today ? today : start;
        const end = ev.allDay ? fmt.addDays(ev.end, -1) : first;
        const last = end < first ? first : end > horizon ? horizon : end;
        for (let d = first; d <= last; d = fmt.addDays(d, 1)) {
          if (!byDay.has(d)) byDay.set(d, []);
          byDay.get(d).push(ev);
        }
      }
      const days = [...byDay.keys()].sort();
      box.replaceChildren(
        ...days.flatMap((d) => [
          h('div', { class: `cal-day${d === today ? ' today' : ''}` }, fmt.dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })),
          ...byDay.get(d).map((ev) => h('div', { class: 'cal-ev' },
            h('span', { class: 't' }, ev.allDay ? 'All day' : fmt.time(ev.start)),
            h('span', { class: 'dot', style: { background: ev.color }, title: ev.calendar }),
            h('span', { class: 'label' }, ev.title, ev.location ? h('span', { class: 'muted small' }, ` · ${ev.location}`) : ''))),
        ]),
        days.length ? '' : h('p', { class: 'empty' }, 'Nothing coming up.'),
        ...errors.map((e) => h('p', { class: 'card-error small' }, e)),
      );
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  every(5 * 60_000, load);
}
