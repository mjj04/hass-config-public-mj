// Calendars from ICS feeds listed under `calendars:` in homepage.yaml
// (Google "secret address in iCal format", iCloud public link, Outlook
// ICS link, or a local .ics file). URLs never reach the browser.

import { readFile } from 'node:fs/promises';
import ical from 'node-ical';
import { addDays, dayKey, startOfDay } from '../lib/time.js';

const TTL = 10 * 60_000;
const feeds = new Map(); // url -> { at, events }

async function fetchFeed(url) {
  const hit = feeds.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.events;
  try {
    let text;
    if (/^(https?|webcal):\/\//i.test(url)) {
      const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } else {
      text = await readFile(url.replace(/^file:\/\//, ''), 'utf8');
    }
    const parsed = await ical.async.parseICS(text);
    const events = Object.values(parsed).filter((e) => e.type === 'VEVENT' && !e.recurrenceid);
    feeds.set(url, { at: Date.now(), events });
    return events;
  } catch (err) {
    console.error(`Calendar feed failed (${redact(url)}): ${err.message}`);
    if (hit) return hit.events; // keep the last good copy
    throw err;
  }
}

function redact(url) {
  return url.replace(/(\/\/[^/]+\/).*/, '$1…');
}

export const routes = {
  'GET /api/calendar': async ({ config, url }) => {
    const tz = config.timezone;
    const days = Math.min(Number(url.searchParams.get('days')) || 7, 62);
    const today = dayKey(new Date(), tz);
    const from = startOfDay(today, tz);
    const to = startOfDay(addDays(today, days), tz);

    const out = [];
    const errors = [];
    await Promise.all(config.calendars.map(async (cal) => {
      try {
        for (const ev of await fetchFeed(cal.url)) {
          const instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
          for (const inst of instances) {
            const end = inst.end || inst.start;
            if (end <= from || inst.start >= to) continue;
            out.push({
              calendar: cal.name,
              color: cal.color || '#4f8cff',
              person: cal.person || null,
              title: String(inst.summary || ev.summary || 'Busy'),
              location: ev.location ? String(ev.location) : '',
              allDay: !!inst.isFullDay,
              // All-day events are dates, not instants.
              start: inst.isFullDay ? dayKey(inst.start, inst.start.tz || 'UTC') : inst.start.toISOString(),
              end: inst.isFullDay ? dayKey(end, end.tz || 'UTC') : end.toISOString(),
            });
          }
        }
      } catch (err) {
        errors.push(`${cal.name}: ${err.message}`);
      }
    }));
    out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : Number(b.allDay) - Number(a.allDay)));
    return { today, events: out, errors };
  },
};
