// Date helpers that work in the configured timezone rather than the
// server's, so "today" means today in the house.

// YYYY-MM-DD for an instant in a timezone.
export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// YYYY-MM-DD of the Monday of the week containing the date.
export function weekKey(date, timeZone) {
  const [y, m, d] = dayKey(date, timeZone).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const monday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - monday);
  return utc.toISOString().slice(0, 10);
}

// Adds whole days to a YYYY-MM-DD string.
export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The instant that local midnight starts on a YYYY-MM-DD day in a timezone.
export function startOfDay(key, timeZone) {
  const guess = new Date(`${key}T00:00:00Z`);
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60_000);
}

function tzOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - date.getTime()) / 60_000);
}
