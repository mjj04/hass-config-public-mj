// Current weather plus an hourly strip and daily forecast.
// Options: days (default 5), hours (default 6); 0 hides either strip

const CODES = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mainly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '🌧️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
const describe = (code, isDay = true) => {
  const [text, day, night] = CODES[code] || ['—', '🌡️'];
  return { text, icon: !isDay && night ? night : day };
};
const round = (n) => Math.round(n);

export default function weather(el, opts, { h, api, fmt, every }) {
  el.append(h('style', {}, `
    .wx-now { display: flex; align-items: center; gap: 16px; }
    .wx-icon { font-size: clamp(40px, 16cqw, 84px); line-height: 1; }
    .wx-temp { font-size: clamp(40px, 16cqw, 80px); font-weight: 300; line-height: 1; }
    .wx-strip { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin-top: 16px; text-align: center; }
    .wx-strip > div { padding: 8px 4px; border-radius: 12px; background: var(--chip); }
    .wx-strip .i { font-size: 22px; }
    .wx-rain { color: var(--accent); }
  `));
  const box = h('div');
  el.append(box);

  async function load() {
    try {
      const w = await api('/api/weather');
      const now = describe(w.current.code, w.current.isDay);
      const hours = opts.hours ?? 6;
      const nextHours = w.hourly.filter((x) => x.time >= `${fmt.dayKey(new Date())}T${String(fmt.hour()).padStart(2, '0')}`).slice(1, 1 + hours);
      box.replaceChildren(
        h('div', { class: 'wx-now' },
          h('div', { class: 'wx-icon' }, now.icon),
          h('div', {},
            h('div', { class: 'wx-temp' }, `${round(w.current.temp)}${w.units.temp}`),
            h('div', {}, now.text),
            h('div', { class: 'muted small' },
              `Feels ${round(w.current.feelsLike)}° · Wind ${round(w.current.wind)} ${w.units.wind}${w.stale ? ' · offline' : ''}`))),
        hours ? h('div', { class: 'wx-strip' }, nextHours.map((x) => h('div', {},
          h('div', { class: 'small muted' }, x.time.slice(11, 16)),
          h('div', { class: 'i' }, describe(x.code).icon),
          h('div', {}, `${round(x.temp)}°`),
          x.rain >= 20 ? h('div', { class: 'small wx-rain' }, `${x.rain}%`) : h('div', { class: 'small' }, ' ')))) : '',
        (opts.days ?? 5) === 0 ? '' : h('div', { class: 'wx-strip' }, w.daily.slice(0, opts.days ?? 5).map((d) => h('div', {},
          h('div', { class: 'small muted' }, fmt.dayLabel(d.date, { weekday: 'short' })),
          h('div', { class: 'i' }, describe(d.code).icon),
          h('div', {}, `${round(d.max)}° `, h('span', { class: 'muted' }, `${round(d.min)}°`)),
          d.rain >= 20 ? h('div', { class: 'small wx-rain' }, `${d.rain}%`) : h('div', { class: 'small' }, ' ')))),
      );
    } catch (err) {
      box.replaceChildren(h('p', { class: 'card-error' }, err.message));
    }
  }
  load();
  every(10 * 60_000, load);
}
