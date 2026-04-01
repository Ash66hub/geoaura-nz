import type { LngLatBounds } from 'maplibre-gl';

export type InteractiveLayerId =
  | 'traffic-volume-layer'
  | 'traffic-volume-points-layer'
  | 'flood-plains-layer'
  | 'flood-rivers-major-layer'
  | 'flood-rivers-minor-layer'
  | 'flood-gauges-layer'
  | 'hamilton-hazard-layer'
  | 'seismic-events-layer'
  | 'seismic-fault-lines-layer'
  | 'police-incidents-choropleth';

export interface ClampedBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const NZ_MIN_LNG = 165.0;
const NZ_MAX_LNG = 179.5;
const NZ_MIN_LAT = -48.5;
const NZ_MAX_LAT = -33.0;

export function clampBoundsToNz(bounds: LngLatBounds): ClampedBounds | null {
  const minLng = Math.max(Math.min(bounds.getWest(), bounds.getEast()), NZ_MIN_LNG);
  const maxLng = Math.min(Math.max(bounds.getWest(), bounds.getEast()), NZ_MAX_LNG);
  const minLat = Math.max(Math.min(bounds.getSouth(), bounds.getNorth()), NZ_MIN_LAT);
  const maxLat = Math.min(Math.max(bounds.getSouth(), bounds.getNorth()), NZ_MAX_LAT);

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  if (minLng >= maxLng || minLat >= maxLat) {
    return null;
  }

  return { minLng, minLat, maxLng, maxLat };
}

export function parseCrimeBreakdown(value: unknown): Record<string, number> {
  if (!value) return {};

  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
    );
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, Number(v) || 0]));
    } catch {
      return {};
    }
  }

  return {};
}

export function getTooltipLines(
  layerId: InteractiveLayerId,
  props: Record<string, unknown>,
): string[] {
  if (layerId === 'traffic-volume-layer' || layerId === 'traffic-volume-points-layer') {
    const title = '<b>Traffic Volume (AADT)</b>';
    const roadName = pickFirstValue(props, [
      'RoadName',
      'roadname',
      'ROAD_NAME',
      'Site_Name',
      'Site_Location',
      'name',
      'Name',
      'SegmentDescription',
      'state_hway',
    ]);
    const siteId = pickFirstValue(props, [
      'Site_Number',
      'site_id',
      'SITE_ID',
      'SiteId',
      'monitoring_site',
    ]);
    const aadt = pickFirstValue(props, [
      'Year2023',
      'Year2022',
      'Year2021',
      'Year2020',
      'Year2019',
      'Year2018',
      'AADT',
      'ADT',
      'Average_AADT',
      'aadt',
      'adt',
      'Aadt',
    ]);
    const output = [title];
    if (roadName) output.push(`Road: ${roadName}`);
    if (siteId) output.push(`Site: ${siteId}`);
    if (aadt) output.push(`AADT: ${aadt}`);
    return output;
  }

  if (layerId === 'police-incidents-choropleth') {
    const title = '<b>Police Incidents</b>';
    const meshblock = pickFirstValue(props, ['meshblock_code']);
    const victimisations = pickFirstValue(props, ['victimisation_sum']);
    const output = [title];
    if (meshblock) output.push(`Meshblock: ${meshblock}`);
    if (victimisations) output.push(`Incidents: ${victimisations}`);
    return output;
  }

  if (layerId === 'seismic-fault-lines-layer') {
    const title = '<b>Active Fault Line</b>';
    const name = pickFirstValue(props, ['name', 'NAME', 'Name', 'FAULT_NAME', 'FaultName']);
    const className = pickFirstValue(props, ['CLASS', 'Class']);
    const age = pickFirstValue(props, ['AGE', 'Age']);
    const output = [title];
    if (name) output.push(`Name: ${name}`);
    if (className) output.push(`Class: ${className}`);
    if (age) output.push(`Age: ${age}`);
    return output;
  }

  if (layerId === 'seismic-events-layer') {
    const title = '<b>Seismic Event</b>';
    const mag = pickFirstValue(props, ['magnitude']);
    const depth = pickFirstValue(props, ['depth']);
    const time = pickFirstValue(props, ['origintime']);
    const output = [title];
    if (mag) output.push(`Magnitude: ${mag}`);
    if (depth) output.push(`Depth: ${depth} km`);
    if (time) output.push(`Time: ${new Date(time).toLocaleString()}`);
    return output;
  }

  if (layerId === 'hamilton-hazard-layer') {
    const title = '<b>Hamilton Flood Hazard</b>';
    const factor = pickFirstValue(props, ['Hazard_Factor']);
    const event = pickFirstValue(props, ['Storm_Event']);
    const output = [title];
    if (factor) output.push(`Hazard Factor: ${factor}`);
    if (event) output.push(`Storm Event: ${event}`);
    return output;
  }

  if (layerId === 'flood-rivers-major-layer' || layerId === 'flood-rivers-minor-layer') {
    const title = '<b>River Network</b>';
    const name = pickFirstValue(props, ['Rivername', 'name', 'River']);
    const order = pickFirstValue(props, ['Strm_Order', 'stream_order']);
    const flow = pickFirstValue(props, ['q100_reach']);
    const output = [title];
    if (name && name.trim() !== '') output.push(`Name: ${name}`);
    if (order) output.push(`Stream Order: ${order}`);
    if (flow) output.push(`Q100 Flow: ${flow}`);
    return output.length > 1 ? output : [title];
  }

  if (layerId === 'flood-plains-layer') {
    const title = '<b>Coastal Flood Plain</b>';
    const detail = pickFirstValue(props, [
      'HazardType',
      'hazard_type',
      'Type',
      'Category',
      'gridcode',
    ]);
    const depth = pickFirstValue(props, ['Depth_m', 'depth', 'DEPTH']);
    const output = [title];
    if (detail && detail.trim() !== '') output.push(`Class: ${detail}`);
    if (depth) output.push(`Depth: ${depth} m`);
    return output.length > 1 ? output : [title];
  }

  const title = '<b>Flow Gauge</b>';
  const name = pickFirstValue(props, ['site_name', 'SiteName', 'Location', 'Name']);
  const owner = pickFirstValue(props, ['owner', 'Owner', 'Council']);
  const output = [title];
  if (name && name.trim() !== '') output.push(`Name: ${name}`);
  if (owner) output.push(`Owner: ${owner}`);
  return output;
}

function pickFirstValue(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = props[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return `${value}`;
    }
  }
  return null;
}
