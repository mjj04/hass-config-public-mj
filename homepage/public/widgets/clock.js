// Big clock with a greeting and the date.
// Options: greeting (true/false), seconds (true/false)

export default function clock(el, opts, { h, fmt, every }) {
  const greet = h('div', { class: 'clock-greet' });
  const time = h('div', { class: 'clock-time' });
  const date = h('div', { class: 'clock-date' });
  el.append(
    h('style', {}, `
      [data-type="clock"] .card-body { display: flex; flex-direction: column; justify-content: center; }
      .clock-greet { font-size: clamp(16px, 6cqw, 28px); color: var(--muted); }
      .clock-time { font-size: clamp(56px, 26cqw, 180px); font-weight: 250; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
      .clock-date { font-size: clamp(18px, 7cqw, 34px); font-weight: 500; margin-top: 6px; }
    `),
    opts.greeting === false ? '' : greet, time, date,
  );

  const tick = () => {
    const now = new Date();
    const hr = fmt.hour(now);
    greet.textContent = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    time.textContent = opts.seconds
      ? new Intl.DateTimeFormat(fmt.locale, { timeZone: fmt.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
      : fmt.time(now);
    date.textContent = fmt.date(now, { weekday: 'long', day: 'numeric', month: 'long' });
  };
  tick();
  every(1000, tick);
}
