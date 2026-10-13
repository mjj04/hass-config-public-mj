// Device controls shared by the house, devices and scenes widgets.

const ICONS = { light: '💡', switch: '🔌', fan: '🌀', sensor: '🌡️', climate: '🔥', cover: '🪟' };
const SWITCHABLE = ['light', 'switch', 'fan'];

export const deviceIcon = (d) => d.icon || ICONS[d.type] || '🔘';
export const isSwitchable = (d) => SWITCHABLE.includes(d.type);
export const isOn = (d) => d.state?.on === true;
const one = (n) => (Math.round(n * 10) / 10).toString();

export function summary(d) {
  if (!d.available) return d.error ? `Offline: ${d.error}` : 'Offline';
  const s = d.state || {};
  const parts = [];
  if (isSwitchable(d)) parts.push(s.on == null ? '—' : s.on ? 'On' : 'Off');
  if (d.type === 'light' && s.on && s.brightness != null) parts.push(`${s.brightness}%`);
  if (s.power != null && (s.on || !isSwitchable(d))) parts.push(`${Math.round(s.power)} W`);
  if (s.temperature != null) parts.push(`${one(s.temperature)}°`);
  if (s.humidity != null) parts.push(`💧${Math.round(s.humidity)}%`);
  if (d.type === 'climate' && s.target != null) parts.push(`set to ${one(s.target)}°`);
  if (d.type === 'cover' && s.position != null) parts.push(s.position === 0 ? 'Closed' : s.position === 100 ? 'Open' : `${s.position}% open`);
  if (s.battery != null && s.battery <= 20) parts.push(`🔋 ${s.battery}%`);
  return parts.join(' · ') || '—';
}

// Temperature and humidity for a room, from whichever device reports them.
export function roomClimate(devices) {
  const t = devices.find((d) => d.available && d.state?.temperature != null);
  const hum = devices.find((d) => d.available && d.state?.humidity != null);
  return { temperature: t?.state.temperature, humidity: hum?.state.humidity };
}

let styled = false;
export function ensureDeviceStyles() {
  if (styled) return;
  styled = true;
  const css = document.createElement('style');
  css.textContent = `
    .dev { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .dev:last-child { border-bottom: 0; }
    .dev-head { display: flex; align-items: center; gap: 12px; min-height: 48px; }
    .dev-ic { flex: none; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: var(--chip); }
    .dev.on .dev-ic { background: var(--glow); }
    .dev.offline { opacity: .55; }
    .dev-txt { flex: 1; min-width: 0; }
    .dev-name { font-weight: 600; }
    .dev-sum { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dev-steps { display: flex; align-items: center; gap: 8px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .dev-extra { display: flex; gap: 8px; align-items: center; margin: 6px 0 0 56px; }
  `;
  document.head.append(css);
}

// One device with its controls. Commands go to the server; the live
// update that follows redraws the row.
export function deviceRow(ctx, d) {
  const { h, api, toast } = ctx;
  ensureDeviceStyles();
  const send = async (body) => {
    try {
      await api(`/api/devices/${encodeURIComponent(d.id)}`, { method: 'POST', body });
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  const s = d.state || {};
  const on = isOn(d);
  const row = h('div', { class: `dev${on ? ' on' : ''}${d.available ? '' : ' offline'}`, 'data-device': d.id });
  const txt = h('div', { class: 'dev-txt' }, h('div', { class: 'dev-name' }, d.name), h('div', { class: 'dev-sum' }, summary(d)));
  const head = h('div', { class: 'dev-head' }, h('span', { class: 'dev-ic', 'aria-hidden': 'true' }, deviceIcon(d)), txt);
  row.append(head);

  if (isSwitchable(d)) {
    const toggle = () => send({ on: !on });
    txt.addEventListener('click', toggle);
    txt.style.cursor = 'pointer';
    head.append(h('button', {
      type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on),
      'aria-label': `${d.name} ${on ? 'on' : 'off'}`, disabled: !d.available, onClick: toggle,
    }));
  }

  if (d.type === 'light' && d.dimmable && d.available) {
    const slider = h('input', {
      type: 'range', min: 1, max: 100, value: on ? (s.brightness ?? 100) : 1, 'aria-label': `${d.name} brightness`,
    });
    slider.addEventListener('change', async () => {
      await send({ brightness: Number(slider.value) });
      slider.blur();
    });
    row.append(h('div', { class: 'dev-extra' }, h('span', { 'aria-hidden': 'true' }, '🔅'), slider, h('span', { 'aria-hidden': 'true' }, '🔆')));
  }

  if (d.type === 'climate') {
    const target = s.target ?? 20;
    head.append(h('div', { class: 'dev-steps' },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Colder', disabled: !d.available, onClick: () => send({ target: target - 0.5 }) }, '−'),
      h('span', {}, `${one(target)}°`),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Warmer', disabled: !d.available, onClick: () => send({ target: target + 0.5 }) }, '+')));
  }

  if (d.type === 'cover') {
    row.append(h('div', { class: 'dev-extra' },
      ['open', 'stop', 'close'].map((c) => h('button', {
        class: 'btn', type: 'button', disabled: !d.available, onClick: () => send({ command: c }),
      }, c[0].toUpperCase() + c.slice(1)))));
  }
  return row;
}
