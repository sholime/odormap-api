// Weather from Open-Meteo (https://open-meteo.com), free and without an API key.
//
// Reports are for odors present right now, so we always ask for the current conditions
// at the report's location.

import type { Point, Weather } from '@odormap/common';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const FIELDS = 'wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m,pressure_msl';

/** Returns the current weather, or undefined if Open-Meteo could not be reached. */
export async function fetchWeather(location: Point): Promise<Weather | undefined> {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: FIELDS,
    wind_speed_unit: 'ms',
  });

  try {
    const response = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const { current } = await response.json();
    const weather: Weather = {
      windSpeedMs: Number(current.wind_speed_10m),
      windDirectionDeg: Number(current.wind_direction_10m),
      temperatureC: Number(current.temperature_2m),
      humidityPercent: Number(current.relative_humidity_2m),
      pressureHpa: Number(current.pressure_msl),
    };
    return Object.values(weather).every(Number.isFinite) ? weather : undefined;
  } catch {
    // A missing weather reading should never stop a report from being saved.
    return undefined;
  }
}
