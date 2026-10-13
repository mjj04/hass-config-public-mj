// A shared checklist: shopping, to-do, packing, anything.
// Options: list (id, e.g. shopping), placeholder

export default function list(el, opts, { h, api, on }) {
  const id = encodeURIComponent(opts.list || 'shopping');
  const input = h('input', { class: 'field', placeholder: opts.placeholder || 'Add an item…', maxlength: 200, enterkeyhint: 'done' });
  const form = h('form', {
    style: { display: 'flex', gap: '8px', marginBottom: '6px' },
    onSubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await api(`/api/lists/${id}/items`, { method: 'POST', body: { text } });
      load();
    },
  }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Add'));
  const items = h('div');
  el.append(form, items);

  async function load() {
    try {
      const data = await api(`/api/lists/${id}`);
      const sorted = [...data.items].sort((a, b) => Number(a.done) - Number(b.done));
      const doneCount = sorted.filter((i) => i.done).length;
      items.replaceChildren(
        ...sorted.map((it) => {
          const toggle = async () => { await api(`/api/lists/${id}/items/${it.id}`, { method: 'PATCH', body: { done: !it.done } }); load(); };
          return h('div', { class: `row${it.done ? ' done' : ''}` },
            h('button', { type: 'button', class: `check${it.done ? ' on' : ''}`, 'aria-label': `${it.text}: ${it.done ? 'ticked' : 'not ticked'}`, onClick: toggle }),
            h('span', { class: 'label strike', onClick: toggle }, it.text),
            h('button', { type: 'button', class: 'btn icon', 'aria-label': `Remove ${it.text}`, onClick: async () => {
              await api(`/api/lists/${id}/items/${it.id}`, { method: 'DELETE' });
              load();
            } }, '×'));
        }),
        sorted.length ? '' : h('p', { class: 'empty' }, 'Nothing on the list.'),
        doneCount ? h('button', { class: 'btn', type: 'button', style: { marginTop: '10px' }, onClick: async () => {
          await api(`/api/lists/${id}/clear-done`, { method: 'POST' });
          load();
        } }, `Clear ${doneCount} ticked`) : '',
      );
    } catch (err) {
      items.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  on('lists', load);
}
