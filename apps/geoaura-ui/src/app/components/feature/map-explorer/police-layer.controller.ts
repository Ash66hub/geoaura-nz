import * as maplibregl from 'maplibre-gl';
import { PoliceService } from '../../../services/police.service';
import { clampBoundsToNz } from './map-explorer.utils';

interface PoliceLayerControllerDeps {
  map: maplibregl.Map;
  policeService: PoliceService;
  isLayerActive: () => boolean;
  bindFeatureTooltips: () => void;
  setLoading: (isLoading: boolean) => void;
  clearSelection: () => void;
}

export class PoliceLayerController {
  private readonly map: maplibregl.Map;
  private readonly policeService: PoliceService;
  private readonly isLayerActive: () => boolean;
  private readonly bindFeatureTooltips: () => void;
  private readonly setLoading: (isLoading: boolean) => void;
  private readonly clearSelection: () => void;

  private layersAdded = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastRequestKey: string | null = null;

  constructor(deps: PoliceLayerControllerDeps) {
    this.map = deps.map;
    this.policeService = deps.policeService;
    this.isLayerActive = deps.isLayerActive;
    this.bindFeatureTooltips = deps.bindFeatureTooltips;
    this.setLoading = deps.setLoading;
    this.clearSelection = deps.clearSelection;
  }

  updateVisibility(minZoom: number) {
    const active = this.isLayerActive();

    if (active && !this.layersAdded) {
      this.initLayers(minZoom);
      return;
    }

    const showByZoom = this.map.getZoom() > minZoom;
    const visibility = active && showByZoom ? 'visible' : 'none';
    const layers = ['police-incidents-choropleth', 'police-incidents-outline'];

    layers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      this.setLoading(false);
      this.clearSelection();
      this.lastRequestKey = null;
    }
  }

  syncZoomGate(minZoom: number) {
    if (!this.layersAdded) return;
    this.updateVisibility(minZoom);
  }

  refreshInView(minZoom: number) {
    if (!this.isLayerActive()) {
      this.setLoading(false);
      return;
    }

    if (this.map.getZoom() <= minZoom) {
      this.setLoading(false);
      this.lastRequestKey = null;
      const source = this.map.getSource('police-meshblocks') as maplibregl.GeoJSONSource;
      source?.setData({ type: 'FeatureCollection', features: [] });
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

      if (requestKey === this.lastRequestKey) return;
      this.lastRequestKey = requestKey;

      this.setLoading(true);

      this.policeService
        .getPoliceIncidentsForExtent(bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat)
        .subscribe({
          next: (data) => {
            const source = this.map.getSource('police-meshblocks') as maplibregl.GeoJSONSource;
            source?.setData(data as unknown as GeoJSON.GeoJSON);
            this.setLoading(false);
          },
          error: (err) => {
            console.error('Error fetching police data:', err);
            this.setLoading(false);
          },
        });
    }, 250);
  }

  private initLayers(minZoom: number) {
    const active = this.isLayerActive();

    if (!this.map.getSource('police-meshblocks')) {
      this.map.addSource('police-meshblocks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!this.map.getLayer('police-incidents-choropleth')) {
      this.map.addLayer({
        id: 'police-incidents-choropleth',
        type: 'fill',
        source: 'police-meshblocks',
        minzoom: minZoom + 0.01,
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'victimisation_rate'], 0],
            0,
            '#84cc16',
            1,
            '#facc15',
            5,
            '#fb923c',
            15,
            '#ef4444',
          ],
          'fill-opacity': 0.7,
        },
        layout: {
          visibility: active ? 'visible' : 'none',
        },
      });
    }

    if (!this.map.getLayer('police-incidents-outline')) {
      this.map.addLayer({
        id: 'police-incidents-outline',
        type: 'line',
        source: 'police-meshblocks',
        minzoom: minZoom + 0.01,
        paint: {
          'line-color': '#000000',
          'line-width': 1.2,
          'line-opacity': 0.85,
        },
        layout: {
          visibility: active ? 'visible' : 'none',
        },
      });
    }

    this.bindFeatureTooltips();
    this.layersAdded = true;
    this.refreshInView(minZoom);
  }
}
