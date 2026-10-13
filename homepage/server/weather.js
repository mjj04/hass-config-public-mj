// Weather from Open-Meteo (free, no API key). Set the location under
// `weather:` in homepage.yaml. Cached for 10 minutes.

let cache = { key: '', at: 0, data: null };
const TTL = 10 * 60_000;

export const routes = {
  'GET /api/weather': async ({ config, fail }) => {
    const w = config.weather;
    if (!w?.latitude || !w?.longitude) fail(400, 'Set weather.latitude and weather.longitude in homepage.yaml');

    const key = `${w.latitude},${w.longitude},${w.units}`;
    if (cache.key === key && Date.now() - cache.at < TTL) return cache.data;

    const imperial = w.units === 'imperial';
    const q = new URLSearchParams({
      latitude: w.latitude,
      longitude: w.longitude,
      timezone: config.timezone,
      forecast_days: '7',
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,relative_humidity_2m',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      wind_speed_unit: 'mph',
      temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    });
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
      const raw = await res.json();
      const data = {
        units: { temp: imperial ? '°F' : '°C', wind: 'mph' },
        current: {
          temp: raw.current.temperature_2m,
          feelsLike: raw.current.apparent_temperature,
          code: raw.current.weather_code,
          wind: raw.current.wind_speed_10m,
          humidity: raw.current.relative_humidity_2m,
          isDay: !!raw.current.is_day,
        },
        hourly: raw.hourly.time.map((t, i) => ({
          time: t,
          temp: raw.hourly.temperature_2m[i],
          rain: raw.hourly.precipitation_probability[i],
          code: raw.hourly.weather_code[i],
        })),
        daily: raw.daily.time.map((d, i) => ({
          date: d,
          code: raw.daily.weather_code[i],
          max: raw.daily.temperature_2m_max[i],
          min: raw.daily.temperature_2m_min[i],
          rain: raw.daily.precipitation_probability_max[i],
          sunrise: raw.daily.sunrise[i],
          sunset: raw.daily.sunset[i],
        })),
      };
      cache = { key, at: Date.now(), data };
      return data;
    } catch (err) {
      // Keep showing the last forecast if the internet drops.
      if (cache.data) return { ...cache.data, stale: true };
      fail(502, `Weather unavailable: ${err.message}`);
    }
  },
};
