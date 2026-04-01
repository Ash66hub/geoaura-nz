import * as maplibregl from 'maplibre-gl';
import { TrafficExtentResponse, TrafficService } from '../../../services/traffic.service';
import { clampBoundsToNz } from './map-explorer.utils';

interface TrafficLayerControllerDeps {
  map: maplibregl.Map;
  trafficService: TrafficService;
  isLayerActive: () => boolean;
  bindFeatureTooltips: () => void;
  addTrafficVolumeLayer: (active: boolean) => void;
  setTrafficLoading: (loading: boolean) => void;
  setHamiltonTrafficLoading: (loading: boolean) => void;
}

export class TrafficLayerController {
  private readonly map: maplibregl.Map;
  private readonly trafficService: TrafficService;
  private readonly isLayerActive: () => boolean;
  private readonly bindFeatureTooltips: () => void;
  private readonly addTrafficVolumeLayer: (active: boolean) => void;
  private readonly setTrafficLoading: (loading: boolean) => void;
  private readonly setHamiltonTrafficLoading: (loading: boolean) => void;

  private layersAdded = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fetchController: AbortController | null = null;
  private lastRequestKey: string | null = null;

  constructor(deps: TrafficLayerControllerDeps) {
    this.map = deps.map;
    this.trafficService = deps.trafficService;
    this.isLayerActive = deps.isLayerActive;
    this.bindFeatureTooltips = deps.bindFeatureTooltips;
    this.addTrafficVolumeLayer = deps.addTrafficVolumeLayer;
    this.setTrafficLoading = deps.setTrafficLoading;
    this.setHamiltonTrafficLoading = deps.setHamiltonTrafficLoading;
  }

  updateVisibility() {
    const active = this.isLayerActive();

    if (active && !this.layersAdded) {
      this.initLayers();
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = ['traffic-volume-layer', 'traffic-volume-points-layer'];
    layers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.fetchController) {
        this.fetchController.abort();
      }
      this.lastRequestKey = null;
      this.setTrafficLoading(false);
      this.setHamiltonTrafficLoading(false);
    }
  }

  refreshInView() {
    if (!this.isLayerActive()) {
      this.setTrafficLoading(false);
      this.setHamiltonTrafficLoading(false);
      return;
    }

    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = setTimeout(() => {
      const bounds = clampBoundsToNz(this.map.getBounds());
      if (!bounds) {
        this.setTrafficLoading(false);
        this.setHamiltonTrafficLoading(false);
        return;
      }

      const requestKey = [
        bounds.minLng.toFixed(2),
        bounds.minLat.toFixed(2),
        bounds.maxLng.toFixed(2),
        bounds.maxLat.toFixed(2),
        Math.floor(this.map.getZoom()),
      ].join(':');

      if (requestKey === this.lastRequestKey) {
        return;
      }
      this.lastRequestKey = requestKey;

      if (this.fetchController) {
        this.fetchController.abort();
      }
      this.fetchController = new AbortController();

      this.setTrafficLoading(true);

      this.trafficService
        .getTrafficForExtent(bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat)
        .subscribe({
          next: (info: TrafficExtentResponse) => {
            const requestDefs = [
              { url: info.traffic_lines_url || info.traffic_url, source: 'lines' },
              { url: info.traffic_points_url, source: 'hamilton_points' },
            ].filter(
              (item): item is { url: string; source: 'lines' | 'hamilton_points' } => !!item.url,
            );

            const seen = new Set<string>();
            const uniqueRequestDefs = requestDefs.filter((item) => {
              if (seen.has(item.url)) return false;
              seen.add(item.url);
              return true;
            });

            if (uniqueRequestDefs.length === 0) {
              const source = this.map.getSource('traffic-volume') as maplibregl.GeoJSONSource;
              source?.setData({ type: 'FeatureCollection', features: [] });
              this.setTrafficLoading(false);
              this.setHamiltonTrafficLoading(false);
              return;
            }

            const hasHamiltonRequest = uniqueRequestDefs.some(
              (item) => item.source === 'hamilton_points',
            );
            this.setHamiltonTrafficLoading(hasHamiltonRequest);

            Promise.all(
              uniqueRequestDefs.map((req) =>
                fetch(req.url, { signal: this.fetchController?.signal })
                  .then((res) => res.json())
                  .then((payload: GeoJSON.GeoJSON) => ({
                    payload,
                    source: req.source,
                    url: req.url,
                  }))
                  .catch((err) => {
                    if (err?.name !== 'AbortError') {
                      console.error(`Error fetching traffic GeoJSON from ${req.url}:`, err);
                    }
                    return null;
                  }),
              ),
            )
              .then(
                (
                  payloads: ({
                    payload: GeoJSON.GeoJSON;
                    source: 'lines' | 'hamilton_points';
                    url: string;
                  } | null)[],
                ) => {
                  const merged: GeoJSON.FeatureCollection = {
                    type: 'FeatureCollection',
                    features: [],
                  };

                  payloads.forEach((entry) => {
                    const payload = entry?.payload;
                    if (
                      payload &&
                      payload.type === 'FeatureCollection' &&
                      Array.isArray(payload.features)
                    ) {
                      const taggedFeatures = payload.features.map((feature) => ({
                        ...feature,
                        properties: {
                          ...(feature.properties || {}),
                          __traffic_source: entry?.source,
                        },
                      }));
                      merged.features.push(...taggedFeatures);
                    }
                  });

                  const source = this.map.getSource('traffic-volume') as maplibregl.GeoJSONSource;
                  source?.setData(merged);
                },
              )
              .finally(() => {
                this.setTrafficLoading(false);
                this.setHamiltonTrafficLoading(false);
              });
          },
          error: (err) => {
            console.error('Error fetching traffic extent info:', err);
            this.setTrafficLoading(false);
            this.setHamiltonTrafficLoading(false);
          },
        });
    }, 250);
  }

  private initLayers() {
    const active = this.isLayerActive();

    this.map.addSource('traffic-volume', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.addTrafficVolumeLayer(active);
    this.bindFeatureTooltips();

    this.layersAdded = true;
    this.refreshInView();
  }
}
