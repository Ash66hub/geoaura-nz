import { Injectable, signal, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FloodService } from './flood.service';

export interface FloodFeatureProperties {
  [key: string]: unknown;
}

export interface FloodLayerCache {
  plains: FloodFeatureProperties[];
  rivers: FloodFeatureProperties[];
  hamiltonHazard: FloodFeatureProperties[];
  lastUpdated: number | null;
}

/** Shared service that caches flood features already loaded by the map's flood layer,
 *  OR fetches them on-demand at report generation time (browser-side, NIWA is reachable). */
@Injectable({ providedIn: 'root' })
export class FloodDataService {
  private floodService = inject(FloodService);

  private _cache = signal<FloodLayerCache>({
    plains: [],
    rivers: [],
    hamiltonHazard: [],
    lastUpdated: null,
  });

  readonly cache = this._cache.asReadonly();

  setPlains(features: GeoJSON.Feature[]) {
    this._cache.update((c) => ({
      ...c,
      plains: features.slice(0, 20).map((f) => f.properties ?? {}),
      lastUpdated: Date.now(),
    }));
  }

  setRivers(features: GeoJSON.Feature[]) {
    this._cache.update((c) => ({
      ...c,
      rivers: features.slice(0, 20).map((f) => f.properties ?? {}),
      lastUpdated: Date.now(),
    }));
  }

  setHamiltonHazard(features: GeoJSON.Feature[]) {
    this._cache.update((c) => ({
      ...c,
      hamiltonHazard: features.slice(0, 20).map((f) => f.properties ?? {}),
      lastUpdated: Date.now(),
    }));
  }

  /** Fetch flood data for specific coordinates directly from NIWA (browser-side). */
  async fetchForCoords(lat: number, lng: number): Promise<Record<string, unknown>> {
    console.log('[FloodDataService] Fetching flood data for report...', { lat, lng });
    
    const radius = 0.01; // ~1km
    const minLng = lng - radius;
    const minLat = lat - radius;
    const maxLng = lng + radius;
    const maxLat = lat + radius;

    try {
      const info: any = await firstValueFrom(
        this.floodService.getFloodInfoForExtent(minLng, minLat, maxLng, maxLat, 20)
      );

      console.log('[FloodDataService] Received flood query URLs:', info);

      const fetchGeoJson = async (url: string | undefined, name: string): Promise<GeoJSON.Feature[]> => {
        if (!url) return [];
        
        // Use a standard AbortController for better compatibility/visibility
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`[FloodDataService] Fetch timeout for ${name}`);
          controller.abort();
        }, 12000);

        try {
          console.log(`[FloodDataService] Starting fetch for ${name}...`);
          const res = await fetch(url, { signal: controller.signal });
          
          if (!res.ok) {
            console.error(`[FloodDataService] ${name} fetch failed with status: ${res.status}`);
            return [];
          }

          const data: GeoJSON.FeatureCollection = await res.json();
          console.log(`[FloodDataService] ${name} received ${data.features?.length || 0} features.`);
          return data.features ?? [];
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.warn(`[FloodDataService] ${name} fetch was cancelled/timed out.`);
          } else {
            console.error(`[FloodDataService] Error fetching ${name}:`, err);
          }
          return [];
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const [plains, rivers] = await Promise.all([
        fetchGeoJson(info.plains_url, 'plains'),
        fetchGeoJson(info.rivers_url, 'rivers'),
      ]);

      let hamiltonFeatures: GeoJSON.Feature[] = [];
      if (info.hamilton_hazard_url) {
        try {
          console.log('[FloodDataService] Fetching Hamilton hazard via proxy...');
          const hData: GeoJSON.FeatureCollection = await this.floodService.getHamiltonHazardGeoJson(
            info.hamilton_hazard_url
          );
          hamiltonFeatures = hData.features ?? [];
          console.log(`[FloodDataService] Hamilton hazard received ${hamiltonFeatures.length} features.`);
        } catch (err) {
          console.error('[FloodDataService] Hamilton hazard fetch failed:', err);
        }
      }

      // Update cache
      if (plains.length) this.setPlains(plains);
      if (rivers.length) this.setRivers(rivers);
      if (hamiltonFeatures.length) this.setHamiltonHazard(hamiltonFeatures);

      return {
        coastal_plains: {
          feature_count: plains.length,
          properties: plains.slice(0, 5).map((f) => f.properties ?? {}),
        },
        river_network: {
          feature_count: rivers.length,
          properties: rivers.slice(0, 5).map((f) => f.properties ?? {}),
        },
        ...(hamiltonFeatures.length > 0
          ? {
              hamilton_flood_hazard: {
                feature_count: hamiltonFeatures.length,
                properties: hamiltonFeatures.slice(0, 5).map((f) => f.properties ?? {}),
              },
            }
          : {}),
      };
    } catch (err) {
      console.error('[FloodDataService] Critical failure in fetchForCoords:', err);
      return {
        coastal_plains: { feature_count: 0, note: 'Fetch failed' },
        river_network: { feature_count: 0, note: 'Fetch failed' },
      };
    }
  }

  /** Returns the cached data in the shape the backend _fetch_flood normally returns. */
  toReportPayload(): Record<string, unknown> | null {
    const c = this._cache();
    if (c.lastUpdated === null) return null;
    return {
      coastal_plains: { feature_count: c.plains.length, properties: c.plains.slice(0, 5) },
      river_network: { feature_count: c.rivers.length, properties: c.rivers.slice(0, 5) },
      ...(c.hamiltonHazard.length > 0
        ? { hamilton_flood_hazard: { feature_count: c.hamiltonHazard.length, properties: c.hamiltonHazard.slice(0, 5) } }
        : {}),
    };
  }
}
