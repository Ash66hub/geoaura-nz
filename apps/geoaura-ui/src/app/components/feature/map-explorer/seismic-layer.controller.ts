import * as maplibregl from 'maplibre-gl';
import { SeismicExtentResponse, SeismicService } from '../../../services/seismic.service';

interface SeismicLayerControllerDeps {
  map: maplibregl.Map;
  seismicService: SeismicService;
  isLayerActive: () => boolean;
  bindFeatureTooltips: () => void;
  addSeismicFaultLinesLayer: (active: boolean) => void;
  addSeismicEventsLayer: (active: boolean) => void;
  setSeismicDataLoading: (loading: boolean) => void;
  setSeismicFaultLinesLoading: (loading: boolean) => void;
}

export class SeismicLayerController {
  private readonly map: maplibregl.Map;
  private readonly seismicService: SeismicService;
  private readonly isLayerActive: () => boolean;
  private readonly bindFeatureTooltips: () => void;
  private readonly addSeismicFaultLinesLayer: (active: boolean) => void;
  private readonly addSeismicEventsLayer: (active: boolean) => void;
  private readonly setSeismicDataLoading: (loading: boolean) => void;
  private readonly setSeismicFaultLinesLoading: (loading: boolean) => void;

  private layersAdded = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fetchController: AbortController | null = null;
  private lastRequestKey: string | null = null;
  private loadCycleId = 0;

  constructor(deps: SeismicLayerControllerDeps) {
    this.map = deps.map;
    this.seismicService = deps.seismicService;
    this.isLayerActive = deps.isLayerActive;
    this.bindFeatureTooltips = deps.bindFeatureTooltips;
    this.addSeismicFaultLinesLayer = deps.addSeismicFaultLinesLayer;
    this.addSeismicEventsLayer = deps.addSeismicEventsLayer;
    this.setSeismicDataLoading = deps.setSeismicDataLoading;
    this.setSeismicFaultLinesLoading = deps.setSeismicFaultLinesLoading;
  }

  updateVisibility() {
    const active = this.isLayerActive();

    if (active && !this.layersAdded) {
      this.initLayers();
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = [
      'seismic-events-layer',
      'seismic-events-cluster',
      'seismic-events-count',
      'seismic-fault-lines-layer',
    ];

    layers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.fetchController) this.fetchController.abort();
      this.lastRequestKey = null;
      this.setSeismicDataLoading(false);
      this.setSeismicFaultLinesLoading(false);
    }
  }

  refreshInView() {
    if (!this.isLayerActive()) {
      this.setSeismicDataLoading(false);
      this.setSeismicFaultLinesLoading(false);
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

      const loadingId = ++this.loadCycleId;
      this.setSeismicDataLoading(true);

      this.seismicService
        .getSeismicInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: SeismicExtentResponse) => {
            const signal = this.fetchController?.signal;
            const tasks: Promise<unknown>[] = [];

            if (info.url) {
              tasks.push(
                fetch(info.url, { signal })
                  .then((res) => res.json())
                  .then((geojson: GeoJSON.GeoJSON) => {
                    const source = this.map.getSource('seismic-events') as maplibregl.GeoJSONSource;
                    source?.setData(geojson);
                  })
                  .catch((err) => {
                    if (err?.name !== 'AbortError') {
                      console.error('Error fetching seismic GeoJSON:', err);
                    }
                  }),
              );
            } else {
              const source = this.map.getSource('seismic-events') as maplibregl.GeoJSONSource;
              source?.setData({ type: 'FeatureCollection', features: [] });
            }

            const faultUrl =
              zoom >= 13 ? info.fault_lines_highres_url || info.fault_lines_url : info.fault_lines_url;
            const shouldFallbackToRegionalFaults =
              zoom >= 13 &&
              !!info.fault_lines_highres_url &&
              !!info.fault_lines_url &&
              info.fault_lines_highres_url !== info.fault_lines_url;

            if (faultUrl) {
              this.setSeismicFaultLinesLoading(true);
              tasks.push(
                fetch(faultUrl, { signal })
                  .then((res) => res.json())
                  .then(async (geojson: GeoJSON.GeoJSON) => {
                    const source = this.map.getSource('seismic-fault-lines') as maplibregl.GeoJSONSource;

                    const featureCount =
                      geojson &&
                      'features' in geojson &&
                      Array.isArray((geojson as GeoJSON.FeatureCollection).features)
                        ? (geojson as GeoJSON.FeatureCollection).features.length
                        : 0;

                    if (shouldFallbackToRegionalFaults && featureCount === 0 && info.fault_lines_url) {
                      try {
                        const fallbackRes = await fetch(info.fault_lines_url, { signal });
                        const fallbackGeojson = (await fallbackRes.json()) as GeoJSON.GeoJSON;
                        source?.setData(fallbackGeojson);
                        return;
                      } catch (err) {
                        if ((err as { name?: string })?.name !== 'AbortError') {
                          console.error('Error fetching fallback fault lines GeoJSON:', err);
                        }
                      }
                    }

                    source?.setData(geojson);
                  })
                  .catch((err) => {
                    if (err?.name !== 'AbortError') {
                      console.error('Error fetching fault lines GeoJSON:', err);
                    }
                  })
                  .finally(() => {
                    if (loadingId === this.loadCycleId) {
                      this.setSeismicFaultLinesLoading(false);
                    }
                  }),
              );
            } else {
              const source = this.map.getSource('seismic-fault-lines') as maplibregl.GeoJSONSource;
              source?.setData({ type: 'FeatureCollection', features: [] });
              this.setSeismicFaultLinesLoading(false);
            }

            Promise.allSettled(tasks).finally(() => {
              if (loadingId === this.loadCycleId) {
                this.setSeismicDataLoading(false);
              }
            });
          },
          error: () => {
            if (loadingId === this.loadCycleId) {
              this.setSeismicDataLoading(false);
              this.setSeismicFaultLinesLoading(false);
            }
          },
        });
    }, 250);
  }

  private initLayers() {
    const active = this.isLayerActive();

    this.map.addSource('seismic-events', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 50,
    });

    this.map.addSource('seismic-fault-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.addSeismicFaultLinesLayer(active);
    this.addSeismicEventsLayer(active);

    this.bindFeatureTooltips();

    this.layersAdded = true;
    this.refreshInView();
  }
}
