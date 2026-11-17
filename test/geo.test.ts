import { describe, expect, it } from 'vitest';
import { AREAS } from '../src/areas.js';
import { findAreaFor, isInsidePolygon, roundLocation } from '../src/geo.js';

const square = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 10 },
  { lat: 10, lon: 10 },
  { lat: 10, lon: 0 },
];

describe('isInsidePolygon', () => {
  it('finds points inside and outside a square', () => {
    expect(isInsidePolygon({ lat: 5, lon: 5 }, square)).toBe(true);
    expect(isInsidePolygon({ lat: 15, lon: 5 }, square)).toBe(false);
  });
});

describe('findAreaFor', () => {
  it('puts the centre of Bačka Topola in its area', () => {
    expect(findAreaFor({ lat: 45.8155, lon: 19.6318 }, AREAS)?.areaId).toBe('backa-topola');
  });

  it('finds no area for Belgrade', () => {
    expect(findAreaFor({ lat: 44.8125, lon: 20.4612 }, AREAS)).toBeUndefined();
  });
});

describe('roundLocation', () => {
  it('rounds to about 100 m', () => {
    expect(roundLocation({ lat: 45.815549, lon: 19.631812 })).toEqual({ lat: 45.816, lon: 19.632 });
  });
});
