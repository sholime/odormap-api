// Towns or regions the app covers.
// Adding a town means adding an entry here and deploying.

import type { Area } from '@odormap/common';

export const AREAS: Area[] = [
  {
    areaId: 'backa-topola',
    name: 'Bačka Topola',
    // A rough box around the municipality and its villages.
    // TODO: replace with the real municipal boundary.
    boundary: [
      { lat: 45.7, lon: 19.4 },
      { lat: 46.0, lon: 19.4 },
      { lat: 46.0, lon: 19.9 },
      { lat: 45.7, lon: 19.9 },
    ],
    languages: ['sr', 'hu'],
    timezone: 'Europe/Belgrade',
    active: true,
  },
];

export function getArea(areaId: string): Area | undefined {
  return AREAS.find((area) => area.areaId === areaId);
}
