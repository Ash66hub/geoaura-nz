import * as maplibregl from 'maplibre-gl';
import { FloodService } from '../../../services/flood.service';

interface FloodExtentInfo {
  gauges_url?: string;
  rivers_url?: string;
  plains_url?: string;
  hamilton_hazard_url?: string;
}

interface FloodLayerControllerDeps {
  map: maplibregl.Map;
  floodService: FloodService;
  isLayerActive: () => boolean;
  bindFeatureTooltips: () => void;
  addRiverNetworkLayer: (active: boolean) => void;
  addFloodPlainsLayer: (active: boolean) => void;
  addHamiltonHazardLayer: (active: boolean) => void;
  addFlowGaugesLayer: (active: boolean) => void;
  setFloodOverviewLoading: (loading: boolean) => void;
  setFloodGaugesLoading: (loading: boolean) => void;
  setFloodPlainsLoading: (loading: boolean) => void;
  setFloodRiversLoading: (loading: boolean) => void;
}

export class FloodLayerController {
  private readonly map: maplibregl.Map;
  private readonly floodService: FloodService;
  private readonly isLayerActive: () => boolean;
  private readonly bindFeatureTooltips: () => void;
  private readonly addRiverNetworkLayer: (active: boolean) => void;
  private readonly addFloodPlainsLayer: (active: boolean) => void;
  private readonly addHamiltonHazardLayer: (active: boolean) => void;
  private readonly addFlowGaugesLayer: (active: boolean) => void;
  private readonly setFloodOverviewLoading: (loading: boolean) => void;
  private readonly setFloodGaugesLoading: (loading: boolean) => void;
  private readonly setFloodPlainsLoading: (loading: boolean) => void;
  private readonly setFloodRiversLoading: (loading: boolean) => void;

  private layersAdded = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fetchController: AbortController | null = null;
  private lastRequestKey: string | null = null;
  private loadCycleId = 0;

  constructor(deps: FloodLayerControllerDeps) {
    this.map = deps.map;
    this.floodService = deps.floodService;
    this.isLayerActive = deps.isLayerActive;
    this.bindFeatureTooltips = deps.bindFeatureTooltips;
    this.addRiverNetworkLayer = deps.addRiverNetworkLayer;
    this.addFloodPlainsLayer = deps.addFloodPlainsLayer;
    this.addHamiltonHazardLayer = deps.addHamiltonHazardLayer;
    this.addFlowGaugesLayer = deps.addFlowGaugesLayer;
    this.setFloodOverviewLoading = deps.setFloodOverviewLoading;
    this.setFloodGaugesLoading = deps.setFloodGaugesLoading;
    this.setFloodPlainsLoading = deps.setFloodPlainsLoading;
    this.setFloodRiversLoading = deps.setFloodRiversLoading;
  }

  updateVisibility() {
    const active = this.isLayerActive();

    if (active && !this.layersAdded) {
      this.initLayers();
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = [
      'flood-rivers-major-layer',
      'flood-rivers-minor-layer',
      'flood-gauges-layer',
      'flood-gauges-cluster',
      'flood-gauges-count',
      'flood-plains-layer',
      'hamilton-hazard-layer',
    ];

    layers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.fetchController) this.fetchController.abort();
      this.lastRequestKey = null;
      this.setFloodOverviewLoading(false);
      this.setFloodGaugesLoading(false);
      this.setFloodPlainsLoading(false);
      this.setFloodRiversLoading(false);
    }
  }

  refreshInView() {
    if (!this.isLayerActive()) {
      this.setFloodOverviewLoading(false);
      this.setFloodGaugesLoading(false);
      this.setFloodPlainsLoading(false);
      this.setFloodRiversLoading(false);
      return;
    }

    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = setTimeout(() => {
      const bounds = this.map.getBounds();
      const zoom = this.map.getZoom();
      const requestKey = [
        bounds.getWest().toFixed(2),
        bounds.getSouth().toFixed(2),
        bounds.getEast().toFixed(2),
        bounds.getNorth().toFixed(2),
        Math.floor(zoom),
      ].join(':');

      if (requestKey === this.lastRequestKey) return;
      this.lastRequestKey = requestKey;

      if (this.fetchController) {
        this.fetchController.abort();
      }
      this.fetchController = new AbortController();

      const cycleId = ++this.loadCycleId;

      this.floodService
        .getFloodInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: FloodExtentInfo) => {
            const signal = this.fetchController?.signal;

            if (info.gauges_url) {
              this.setFloodGaugesLoading(true);
              fetch(info.gauges_url, { signal })
                .then((res) => res.json())
                .then((geojson: GeoJSON.GeoJSON) => {
                  const source = this.map.getSource('flood-gauges') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching gauges GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.loadCycleId) {
                    this.setFloodGaugesLoading(false);
                  }
                });
            } else {
              this.setFloodGaugesLoading(false);
            }

            if (info.rivers_url) {
              this.setFloodRiversLoading(true);
              fetch(info.rivers_url, { signal })
                .then((res) => res.json())
                .then((geojson: GeoJSON.GeoJSON) => {
                  const source = this.map.getSource('flood-rivers') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching rivers GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.loadCycleId) {
                    this.setFloodRiversLoading(false);
                  }
                });
            } else {
              this.setFloodRiversLoading(false);
            }

            const plainsSource = this.map.getSource('flood-plains') as maplibregl.GeoJSONSource;
            const showPlains = zoom >= 7;

            if (!showPlains) {
              plainsSource?.setData({ type: 'FeatureCollection', features: [] });
              this.setFloodPlainsLoading(false);
            } else if (info.plains_url) {
              this.setFloodPlainsLoading(true);
              fetch(info.plains_url, { signal })
                .then((res) => res.json())
                .then((geojson: GeoJSON.GeoJSON) => {
                  plainsSource?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching plains GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.loadCycleId) {
                    this.setFloodPlainsLoading(false);
                  }
                });
            } else {
              this.setFloodPlainsLoading(false);
            }

            const hmSource = this.map.getSource('hamilton-hazard') as maplibregl.GeoJSONSource;
            const showHamilton = zoom >= 13;

            if (!showHamilton) {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
              this.setFloodOverviewLoading(false);
            } else if (info.hamilton_hazard_url) {
              this.setFloodOverviewLoading(true);
              this.floodService
                .getHamiltonHazardGeoJson(info.hamilton_hazard_url, signal)
                .then((geojson: GeoJSON.GeoJSON) => {
                  hmSource?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching Hamilton Hazard GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.loadCycleId) {
                    this.setFloodOverviewLoading(false);
                  }
                });
            } else {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
              this.setFloodOverviewLoading(false);
            }
          },
          error: () => {
            if (cycleId === this.loadCycleId) {
              this.setFloodOverviewLoading(false);
              this.setFloodGaugesLoading(false);
              this.setFloodPlainsLoading(false);
              this.setFloodRiversLoading(false);
            }
          },
        });
    }, 250);
  }

  private initLayers() {
    const active = this.isLayerActive();

    this.map.addSource('flood-rivers', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addRiverNetworkLayer(active);

    this.map.addSource('flood-plains', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addFloodPlainsLayer(active);

    this.map.addSource('hamilton-hazard', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addHamiltonHazardLayer(active);

    this.map.addSource('flood-gauges', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 50,
    });
    this.addFlowGaugesLayer(active);

    this.bindFeatureTooltips();

    this.layersAdded = true;
    this.refreshInView();
  }
}
