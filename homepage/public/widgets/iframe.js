// Embed any web page (a camera feed, Grafana, a map, ...). Some sites
// refuse to be embedded; use a links tile for those.
// Options: url, refresh (seconds, reloads the frame)

export default function iframe(el, opts, { h, every }) {
  el.style.padding = '0';
  const frame = h('iframe', {
    src: opts.url,
    title: opts.title || opts.url,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    style: { width: '100%', height: '100%', border: '0', display: 'block' },
  });
  el.append(frame);
  if (opts.refresh) every(opts.refresh * 1000, () => { frame.src = opts.url; });
}
