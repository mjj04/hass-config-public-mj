// Tiles that open other sites and services.
// Options: items: [{ name, url, icon (emoji or image URL), newTab (default true) }]

export default function links(el, opts, { h }) {
  el.append(h('style', {}, `
    .links { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .links a { display: grid; justify-items: center; align-content: center; gap: 8px; min-height: 96px; padding: 10px; border-radius: 14px; background: var(--chip); color: var(--text); text-decoration: none; font-weight: 600; text-align: center; }
    .links .ic { font-size: 30px; line-height: 1; }
    .links img.ic { width: 36px; height: 36px; object-fit: contain; }
  `));
  const isImage = (s) => /^(\/|https?:)/.test(s || '');
  el.append(h('div', { class: 'links' }, (opts.items || []).map((it) => h('a', {
    href: it.url,
    target: it.newTab === false ? null : '_blank',
    rel: 'noopener',
  },
  isImage(it.icon) ? h('img', { class: 'ic', src: it.icon, alt: '' }) : h('span', { class: 'ic', 'aria-hidden': 'true' }, it.icon || '🔗'),
  h('span', {}, it.name)))));
}
