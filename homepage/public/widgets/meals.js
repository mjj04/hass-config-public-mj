// Meal plan: one line per day, edit in place. Saves when you leave the box.
// Options: days (default 7), from ("today" or "week" to start on Monday)

export default function meals(el, opts, { h, api, fmt, on }) {
  el.append(h('style', {}, `
    .meal { display: grid; grid-template-columns: 6.5em 1fr; align-items: center; gap: 10px; padding: 4px 0; }
    .meal .d { font-weight: 600; }
    .meal.today .d { color: var(--accent); }
    .meal input { min-height: 44px; border-color: transparent; background: var(--chip); }
    .meal input:focus { border-color: var(--accent); outline: none; }
  `));
  const box = h('div');
  el.append(box);

  async function load() {
    if (box.contains(document.activeElement)) return; // don't clobber typing
    try {
      const data = await api(`/api/meals?days=${opts.days || 7}&from=${opts.from || 'today'}`);
      box.replaceChildren(...data.days.map((d) => {
        const input = h('input', { class: 'field', value: d.text, placeholder: '—', maxlength: 200, enterkeyhint: 'done' });
        let saved = d.text;
        const save = async () => {
          if (input.value.trim() === saved) return;
          saved = input.value.trim();
          await api(`/api/meals/${d.date}`, { method: 'PUT', body: { text: saved } });
        };
        input.addEventListener('change', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        return h('label', { class: `meal${d.date === data.today ? ' today' : ''}` },
          h('span', { class: 'd' }, fmt.dayLabel(d.date, { weekday: 'short', day: 'numeric' })), input);
      }));
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  on('meals', load);
}
