// Small location helpers.

import type { Area, Point, Polygon } from '@odormap/common';

/**
 * True if the point lies inside the polygon.
 * Uses the standard "ray casting" method: count how many polygon edges a line
 * going east from the point crosses. An odd count means the point is inside.
 */
export function isInsidePolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crossesLatitude = a.lat > point.lat !== b.lat > point.lat;
    if (crossesLatitude) {
      const lonAtCrossing = a.lon + ((point.lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
      if (point.lon < lonAtCrossing) inside = !inside;
    }
  }
  return inside;
}

/** The first active area that contains the point, if any. */
export function findAreaFor(point: Point, areas: Area[]): Area | undefined {
  return areas.find((area) => area.active && isInsidePolygon(point, area.boundary));
}

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
