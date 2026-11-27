// Rounding locations for public reports.
// The shared helpers (isInsidePolygon, findAreaFor) live in @odormap/common.

import type { Point } from '@odormap/common';

// Steps of 0.005 degrees: about 550 m north-south and 390 m east-west here,
// so a rounded point is at most about 280 m from the real one.
const STEPS_PER_DEGREE = 200;

/**
 * Rounds a location to about 500 m, so reports shown in the app cannot pinpoint someone's home.
 * The exact location is only stored, for later analysis.
 */
export function roundLocation(point: Point): Point {
  return {
    lat: Math.round(point.lat * STEPS_PER_DEGREE) / STEPS_PER_DEGREE,
    lon: Math.round(point.lon * STEPS_PER_DEGREE) / STEPS_PER_DEGREE,
  };
}
