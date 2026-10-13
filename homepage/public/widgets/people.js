// Who's home. Tap someone to switch them between Home and Out.

export default function people(el, _opts, { h, api, fmt, on }) {
  el.append(h('style', {}, `
    .ppl { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; }
    .ppl button { display: grid; justify-items: center; gap: 6px; padding: 8px 4px; border: 0; border-radius: 14px; background: none; }
    .ppl .av { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-size: 24px; font-weight: 700; color: #fff; background-size: cover; background-position: center; }
    .ppl .away .av { filter: grayscale(1); opacity: .45; }
    .ppl .st { font-size: 13px; color: var(--ok); font-weight: 600; }
    .ppl .away .st { color: var(--muted); }
  `));
  const box = h('div', { class: 'ppl' });
  el.append(box);

  async function load() {
    try {
      const { people } = await api('/api/people');
      box.replaceChildren(...people.map((p) => {
        const away = p.status === 'away';
        const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return h('button', {
          type: 'button',
          class: away ? 'away' : '',
          'aria-label': `${p.name} is ${away ? 'out' : 'home'}. Tap to change.`,
          onClick: async () => {
            await api(`/api/people/${encodeURIComponent(p.id)}`, { method: 'POST', body: { status: away ? 'home' : 'away' } });
            load();
          },
        },
        h('span', { class: 'av', style: { background: p.photo ? `url("${encodeURI(p.photo)}") center/cover` : p.color } }, p.photo ? '' : initials),
        h('span', {}, p.name),
        h('span', { class: 'st' }, away ? 'Out' : 'Home', p.since ? h('span', { class: 'muted' }, ` · ${fmt.since(p.since)}`) : ''));
      }));
      if (!people.length) box.replaceChildren(h('p', { class: 'empty' }, 'Add people under people: in homepage.yaml.'));
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  on('people', load);
}
