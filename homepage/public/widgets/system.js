// Server health and Docker containers.
// Options: show (["host", "docker"], default both), stopped (show stopped
//          containers, default true)

export default function system(el, opts, { h, api, fmt, every }) {
  el.append(h('style', {}, `
    .sys-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
    .sys-head b { font-size: 20px; }
    .sys-meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 20px; margin-bottom: 14px; }
    .sys-meter .top { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .sys-meter .v { font-weight: 700; font-variant-numeric: tabular-nums; }
    .bar > span.hot { background: var(--warn); }
    .bar > span.crit { background: var(--bad); }
    .ctr { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
    .ctr:last-child { border-bottom: 0; }
    .ctr .dot.running { background: var(--ok); }
    .ctr .dot.unhealthy { background: var(--bad); }
    .ctr .dot.off { background: var(--muted); }
    .ctr .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ctr .num { width: 4.5em; text-align: right; color: var(--muted); }
  `));
  const box = h('div');
  el.append(box);
  const show = opts.show || ['host', 'docker'];

  const meter = (label, pct, detail) => {
    const p = Math.max(0, Math.min(100, pct || 0));
    return h('div', { class: 'sys-meter' },
      h('div', { class: 'top' }, h('span', {}, label), h('span', { class: 'v' }, `${Math.round(p)}%`)),
      h('div', { class: 'bar' }, h('span', { class: p >= 90 ? 'crit' : p >= 75 ? 'hot' : '', style: { width: `${p}%` } })),
      detail ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, detail) : '');
  };

  async function load() {
    try {
      const s = await api('/api/system');
      const parts = [];
      if (show.includes('host')) {
        const m = s.host.memory;
        parts.push(
          h('div', { class: 'sys-head' }, h('b', {}, s.name),
            h('span', { class: 'muted small' }, `up ${fmt.duration(s.host.uptime)} · load ${s.host.load.join(' ')}${s.host.temperature ? ` · ${Math.round(s.host.temperature)}°C` : ''}`)),
          h('div', { class: 'sys-meters' },
            meter('CPU', s.host.cpu, `${s.host.cores} cores`),
            meter('Memory', (m.used / m.total) * 100, `${fmt.bytes(m.used)} of ${fmt.bytes(m.total)}`),
            s.host.disks.map((d) => (d.error
              ? h('div', { class: 'small card-error' }, `${d.name}: ${d.error}`)
              : meter(d.name, (d.used / d.total) * 100, `${fmt.bytes(d.total - d.used)} free of ${fmt.bytes(d.total)}`)))),
        );
      }
      if (show.includes('docker')) {
        const d = s.docker;
        if (!d.available) {
          parts.push(h('p', { class: 'card-error small' }, `Docker: ${d.error}`));
        } else {
          const list = opts.stopped === false ? d.containers.filter((c) => c.state === 'running') : d.containers;
          const running = d.containers.filter((c) => c.state === 'running').length;
          parts.push(
            h('div', { class: 'small muted', style: { margin: '4px 0' } }, `${running} running · ${d.containers.length - running} stopped`),
            ...list.map((c) => h('div', { class: 'ctr', title: `${c.image} — ${c.status}` },
              h('span', { class: `dot ${c.health === 'unhealthy' ? 'unhealthy' : c.state === 'running' ? 'running' : 'off'}` }),
              h('span', { class: 'name' }, c.name, c.state !== 'running' ? h('span', { class: 'muted small' }, ` · ${c.status}`) : ''),
              h('span', { class: 'num' }, c.cpu != null ? `${c.cpu.toFixed(1)}%` : ''),
              h('span', { class: 'num' }, c.memUsed != null ? fmt.bytes(c.memUsed) : ''))),
          );
        }
      }
      box.replaceChildren(...parts);
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  every((opts.refresh || 15) * 1000, load);
}
