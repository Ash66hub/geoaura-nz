import type { MapGeoJSONFeature } from 'maplibre-gl';

export function geometryContainsPoint(
  geometry: GeoJSON.Geometry | null | undefined,
  lng: number,
  lat: number,
): boolean {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return polygonContainsPoint(geometry.coordinates, lng, lat);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, lng, lat));
  }

  return false;
}

export function chooseBoundaryFeature(
  candidates: MapGeoJSONFeature[],
  lng: number,
  lat: number,
): MapGeoJSONFeature | undefined {
  const polygons = candidates.filter(
    (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
  );

  return polygons.find((f) => geometryContainsPoint(f.geometry, lng, lat)) ?? polygons[0];
}

function polygonContainsPoint(polygon: number[][][], lng: number, lat: number): boolean {
  if (polygon.length === 0) return false;

  const insideOuter = ringContainsPoint(polygon[0], lng, lat);
  if (!insideOuter) return false;

  for (let i = 1; i < polygon.length; i++) {
    if (ringContainsPoint(polygon[i], lng, lat)) {
      return false;
    }
  }

  return true;
}

function ringContainsPoint(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}
