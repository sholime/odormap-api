// Weather from Open-Meteo (https://open-meteo.com), free and without an API key.
//
// For a smell noticed in the last 30 minutes we use the current conditions.
// For an older one we use the hourly values for the hour it was noticed.

import type { Point, Weather } from '@odormap/common';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const FIELDS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m';
const THIRTY_MINUTES = 30 * 60 * 1000;

/** Returns the weather, or undefined if Open-Meteo could not be reached. */
export async function fetchWeather(location: Point, observedAt: Date, now = new Date()): Promise<Weather | undefined> {
  const isRecent = now.getTime() - observedAt.getTime() < THIRTY_MINUTES;
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    wind_speed_unit: 'ms',
    timezone: 'GMT',
  });
  if (isRecent) {
    params.set('current', FIELDS);
  } else {
    const hour = observedAt.toISOString().slice(0, 13) + ':00'; // e.g. "2026-11-17T18:00"
    params.set('hourly', FIELDS);
    params.set('start_hour', hour);
    params.set('end_hour', hour);
  }

  try {
    const response = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const data = await response.json();
    const weather = isRecent ? readCurrent(data.current) : readFirstHour(data.hourly);
    const hasAllNumbers = [weather.windSpeedMs, weather.windDirectionDeg, weather.windGustsMs, weather.temperatureC]
      .every(Number.isFinite);
    return hasAllNumbers ? weather : undefined;
  } catch {
    // A missing weather reading should never stop a report from being saved.
    return undefined;
  }
}

type Reading = Record<string, number | string>;
type HourlyReadings = Record<string, (number | string)[]>;

function readCurrent(current: Reading): Weather {
  return {
    windSpeedMs: Number(current.wind_speed_10m),
    windDirectionDeg: Number(current.wind_direction_10m),
    windGustsMs: Number(current.wind_gusts_10m),
    temperatureC: Number(current.temperature_2m),
    weatherTime: `${current.time}:00Z`,
  };
}

function readFirstHour(hourly: HourlyReadings): Weather {
  return {
    windSpeedMs: Number(hourly.wind_speed_10m![0]),
    windDirectionDeg: Number(hourly.wind_direction_10m![0]),
    windGustsMs: Number(hourly.wind_gusts_10m![0]),
    temperatureC: Number(hourly.temperature_2m![0]),
    weatherTime: `${hourly.time![0]}:00Z`,
  };
}
