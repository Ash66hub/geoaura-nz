import * as maplibregl from 'maplibre-gl';
import { Subscription } from 'rxjs';
import { RentService } from '../../../services/rent.service';
import { clampBoundsToNz } from './map-explorer.utils';

import { finalize } from 'rxjs/operators';

interface RentLayerControllerDeps {
  map: maplibregl.Map;
  rentService: RentService;
  isLayerActive: () => boolean;
  bindFeatureTooltips: () => void;
  setLoading: (isLoading: boolean) => void;
}

export class RentLayerController {
  private readonly map: maplibregl.Map;
  private readonly rentService: RentService;
  private readonly isLayerActive: () => boolean;
  private readonly bindFeatureTooltips: () => void;
  private readonly setLoading: (isLoading: boolean) => void;

  private layersAdded = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastRequestKey: string | null = null;
  private currentSubscription: Subscription | null = null;

  constructor(deps: RentLayerControllerDeps) {
    this.map = deps.map;
    this.rentService = deps.rentService;
    this.isLayerActive = deps.isLayerActive;
    this.bindFeatureTooltips = deps.bindFeatureTooltips;
    this.setLoading = deps.setLoading;
  }

  updateVisibility() {
    const active = this.isLayerActive();
    const visibility = active ? 'visible' : 'none';
    const layers = ['rent-suburbs-fill', 'rent-suburbs-outline'];

    if (active && !this.layersAdded) {
      if (!this.map.loaded()) {
        this.map.once('load', () => this.initLayers());
        return;
      }
      this.initLayers();
      return;
    }

    layers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      this.setLoading(false);
      this.lastRequestKey = null;
    }
  }

  refreshInView() {
    if (!this.isLayerActive()) {
      this.setLoading(false);
      return;
    }

    if (this.map.getZoom() < 10) {
      this.clearData();
      this.setLoading(false);
      return;
    }

    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = setTimeout(() => {
      const bounds = clampBoundsToNz(this.map.getBounds());
      if (!bounds) {
        this.setLoading(false);
        return;
      }

      const requestKey = [
        bounds.minLng.toFixed(2),
        bounds.minLat.toFixed(2),
        bounds.maxLng.toFixed(2),
        bounds.maxLat.toFixed(2),
      ].join(':');

      if (requestKey === this.lastRequestKey) {
        return;
      }
      this.lastRequestKey = requestKey;

      this.setLoading(true);
      
      if (this.currentSubscription) {
        this.currentSubscription.unsubscribe();
      }

      this.currentSubscription = this.rentService.getRentAreasForExtent(bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat)
        .subscribe({
          next: (data) => {
            const source = this.map.getSource('rent-suburbs') as maplibregl.GeoJSONSource;
            source?.setData(data);
            this.setLoading(false);
            this.currentSubscription = null;
          },
          error: (err) => {
            console.error('Error fetching rent suburbs:', err);
            this.setLoading(false);
            this.currentSubscription = null;
          }
        });
    }, 300);
  }

  private clearData() {
    const source = this.map.getSource('rent-suburbs') as maplibregl.GeoJSONSource;
    source?.setData({ type: 'FeatureCollection', features: [] });
    this.lastRequestKey = null;
  }

  private initLayers() {
    if (!this.map.getSource('rent-suburbs')) {
      this.map.addSource('rent-suburbs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!this.map.getLayer('rent-suburbs-fill')) {
      this.map.addLayer({
        id: 'rent-suburbs-fill',
        type: 'fill',
        source: 'rent-suburbs',
        paint: {
          'fill-color': '#10b981', // Emerald 500
          'fill-opacity': 0.25,
        },
        layout: {
          visibility: this.isLayerActive() ? 'visible' : 'none',
        },
      });
    }

    if (!this.map.getLayer('rent-suburbs-outline')) {
      this.map.addLayer({
        id: 'rent-suburbs-outline',
        type: 'line',
        source: 'rent-suburbs',
        paint: {
          'line-color': '#000000', // Black outline
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
        layout: {
          visibility: this.isLayerActive() ? 'visible' : 'none',
        },
      });
    }

    this.bindFeatureTooltips();
    this.layersAdded = true;
    this.refreshInView();
  }
}
