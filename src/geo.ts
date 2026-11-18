// Rounding locations for public reports.
// The shared helpers (isInsidePolygon, findAreaFor) live in @odormap/common.

import type { Point } from '@odormap/common';

/**
 * Rounds a location to 3 decimal places, about 100 m,
 * so public reports cannot pinpoint someone's home.
 */
export function roundLocation(point: Point): Point {
  return {
    lat: Math.round(point.lat * 1000) / 1000,
    lon: Math.round(point.lon * 1000) / 1000,
  };
}
