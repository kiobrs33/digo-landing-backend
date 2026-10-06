import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common';

/** Punto [lat, lng]: el orden que usa Leaflet en la landing. */
export type LatLng = [number, number];

/** Límites para que una zona no cargue de más la landing (ni el body de la petición). */
export const MAX_RINGS = 30;
export const MAX_POINTS = 4000;

/** Colores del mapa que ofrece el panel (contrastan con las teselas OSM y entre sí). */
export const ZONE_COLORS = [
  '#de087e', // magenta
  '#3552c4', // azul estelar
  '#0f8a7e', // turquesa
  '#7a3fc0', // violeta
  '#d2601a', // naranja
  '#2f7d32', // verde
  '#b0306a', // frambuesa
  '#041c7b', // navy
] as const;

/**
 * Valida y limpia el contorno de una zona: anillos de al menos 4 puntos [lat, lng] válidos,
 * con 6 decimales (≈ 10 cm) y sin repetir el último punto si cierra el anillo.
 */
export function normalizeRings(value: unknown): LatLng[][] {
  const invalid = (detail: string) =>
    new BadRequestException([`El contorno de la zona no es válido: ${detail}`]);
  if (!Array.isArray(value) || value.length === 0)
    throw invalid('falta el contorno');
  if (value.length > MAX_RINGS)
    throw invalid(`tiene más de ${MAX_RINGS} partes`);

  let total = 0;
  const rings = value.map((ring: unknown) => {
    if (!Array.isArray(ring)) throw invalid('una parte no es una lista');
    const points = ring.map((point: unknown): LatLng => {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw invalid('hay un punto que no es [latitud, longitud]');
      }
      const [lat, lng] = point as number[];
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
        throw invalid('hay un punto fuera del mapa');
      return [round(lat), round(lng)];
    });
    const [first] = points;
    const last = points.at(-1);
    if (first && last && first[0] === last[0] && first[1] === last[1])
      points.pop();
    if (points.length < 3) throw invalid('una parte tiene menos de 3 puntos');
    total += points.length;
    return points;
  });
  if (total > MAX_POINTS)
    throw invalid(`tiene más de ${MAX_POINTS} puntos; simplifícalo`);
  return rings;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Distrito encontrado en OpenStreetMap, listo para guardarse como zona. */
export type BoundaryResult = {
  osmRef: string;
  name: string;
  /** Nombre completo, p. ej. "Socabaya, Arequipa, Perú". */
  place: string;
  /** Tipo de lugar según OSM: city, town, village, suburb… */
  kind: string;
  rings: LatLng[][];
  points: number;
};

type NominatimResult = {
  osm_type: string;
  osm_id: number;
  name: string;
  display_name: string;
  addresstype: string;
  geojson?: { type: string; coordinates: unknown };
};

const logger = new Logger('CoverageBoundaries');

/**
 * Busca límites de distrito (o de otro lugar con contorno) en Nominatim, la búsqueda pública de
 * OpenStreetMap. Solo devuelve resultados con polígono; el contorno llega simplificado (~10 m).
 */
export async function searchBoundaries(
  query: string,
): Promise<BoundaryResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    polygon_geojson: '1',
    polygon_threshold: '0.0001',
    countrycodes: 'pe',
    limit: '8',
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        // Política de uso de Nominatim: identificar la aplicación.
        'User-Agent': 'digo-landing-backend/1.0 (panel de contenidos Digo)',
        'Accept-Language': 'es',
      },
      signal: AbortSignal.timeout(12_000),
    },
  ).catch((error: unknown) => {
    logger.warn(`Nominatim sin respuesta: ${String(error)}`);
    return null;
  });
  if (!response?.ok) {
    throw new BadGatewayException(
      'No se pudo consultar OpenStreetMap. Intenta de nuevo en unos segundos.',
    );
  }
  const results = (await response.json()) as NominatimResult[];
  return results.flatMap((result) => {
    const rings = ringsFromGeoJson(result.geojson);
    if (!rings.length) return [];
    return [
      {
        osmRef: `${result.osm_type}/${result.osm_id}`,
        name: result.name || result.display_name.split(',')[0],
        place: result.display_name,
        kind: result.addresstype,
        rings,
        points: rings.reduce((sum, ring) => sum + ring.length, 0),
      },
    ];
  });
}

/**
 * Anillos exteriores de un Polygon o MultiPolygon GeoJSON ([lng, lat] → [lat, lng]). Los huecos
 * se descartan: un distrito con fibra no tiene "islas" sin servicio en el mapa.
 */
export function ringsFromGeoJson(geojson: NominatimResult['geojson']) {
  if (!geojson) return [];
  const polygons =
    geojson.type === 'Polygon'
      ? [geojson.coordinates as number[][][]]
      : geojson.type === 'MultiPolygon'
        ? (geojson.coordinates as number[][][][])
        : [];
  return polygons
    .map(([outer]) =>
      (outer ?? []).map(([lng, lat]): LatLng => [round(lat), round(lng)]),
    )
    .filter((ring) => ring.length >= 4)
    .map((ring) => {
      const [first] = ring;
      const last = ring.at(-1)!;
      return first[0] === last[0] && first[1] === last[1]
        ? ring.slice(0, -1)
        : ring;
    });
}
