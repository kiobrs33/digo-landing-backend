import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { normalizeRings, ringsFromGeoJson } from './coverage-zones.js';

const square = [
  [-16.4, -71.5],
  [-16.4, -71.6],
  [-16.5, -71.6],
  [-16.5, -71.5],
];

describe('normalizeRings', () => {
  it('redondea a 6 decimales y quita el punto que cierra el anillo', () => {
    const rings = normalizeRings([
      [
        [-16.123456789, -71.987654321],
        ...square.slice(1),
        [-16.123456789, -71.987654321],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(rings[0][0]).toEqual([-16.123457, -71.987654]);
  });

  it('rechaza contornos vacíos, puntos inválidos o partes con menos de 3 puntos', () => {
    expect(() => normalizeRings([])).toThrow(BadRequestException);
    expect(() => normalizeRings([[[-16.4, 'x'], ...square]])).toThrow(
      BadRequestException,
    );
    expect(() => normalizeRings([[[-95, -71.5], ...square]])).toThrow(
      BadRequestException,
    );
    expect(() => normalizeRings([square.slice(0, 2)])).toThrow(
      BadRequestException,
    );
  });

  it('rechaza contornos con demasiados puntos', () => {
    const huge = Array.from({ length: 4001 }, (_, i) => [-16 - i / 1e5, -71.5]);
    try {
      normalizeRings([huge]);
      expect.fail('debió rechazarse');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: [expect.stringMatching(/más de 4000 puntos/)],
      });
    }
  });
});

describe('ringsFromGeoJson', () => {
  const lngLat = square.map(([lat, lng]) => [lng, lat]);

  it('convierte un Polygon a [lat, lng] sin el punto de cierre y sin huecos', () => {
    const rings = ringsFromGeoJson({
      type: 'Polygon',
      coordinates: [[...lngLat, lngLat[0]], lngLat],
    });
    expect(rings).toEqual([square]);
  });

  it('toma el anillo exterior de cada parte de un MultiPolygon', () => {
    const rings = ringsFromGeoJson({
      type: 'MultiPolygon',
      coordinates: [[[...lngLat, lngLat[0]]], [[...lngLat, lngLat[0]]]],
    });
    expect(rings).toHaveLength(2);
  });

  it('ignora puntos y geometrías sin área', () => {
    expect(
      ringsFromGeoJson({ type: 'Point', coordinates: [-71.5, -16.4] }),
    ).toEqual([]);
    expect(ringsFromGeoJson(undefined)).toEqual([]);
  });
});
