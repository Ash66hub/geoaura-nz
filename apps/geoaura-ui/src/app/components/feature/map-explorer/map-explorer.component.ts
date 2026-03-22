import { Component, OnInit, ElementRef, viewChild, inject, signal, NgZone } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { LngLatBoundsLike } from 'maplibre-gl';
import { environment } from '../../../../environments/environment';
import { FloodService } from '../../../services/flood.service';
import { PropertyService } from '../../../services/property.service';
import { SeismicService } from '../../../services/seismic.service';
import { CommonModule } from '@angular/common';
import { GaugeModalComponent } from '../flood-flow-gauge/gauge-modal/gauge-modal.component';
import { GaugeProperties, LayerItem } from '../../../common/flood-flow-gauge';

const NZ_BOUNDS: LngLatBoundsLike = [
  [165.0, -48.5],
  [179.5, -33.0],
];

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  imports: [CommonModule, GaugeModalComponent],
  templateUrl: './map-explorer.component.html',
  styleUrl: './map-explorer.component.scss',
})
export class MapExplorerComponent implements OnInit {
  private mapContainer = viewChild<ElementRef>('mapContainer');
  private floodService = inject(FloodService);
  private seismicService = inject(SeismicService);
  private propertyService = inject(PropertyService);
  private ngZone = inject(NgZone);

  selectedGauge = signal<GaugeProperties | null>(null);

  layers = signal<LayerItem[]>([
    {
      id: 'traffic',
      name: 'Traffic Volume',
      icon: 'traffic',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-primary',
    },
    {
      id: 'flood',
      name: 'Flood Risk',
      icon: 'water_damage',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-blue-400',
    },
    {
      id: 'seismic',
      name: 'Seismic Events',
      icon: 'waves',
      active: false,
      colorClass: 'orange',
      iconColorClass: 'text-accent-orange',
    },
    {
      id: 'landValue',
      name: 'Land Value',
      icon: 'money',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-slate-500',
    },
    {
      id: 'police',
      name: 'Police Incidents',
      icon: 'local_police',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-slate-500',
    },
  ]);

  currentMapMode = signal<'satellite' | 'topo'>('satellite');
  private topoLayers: string[] = [];
  private map?: maplibregl.Map;
  private floodLayersAdded = false;
  private floodRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private floodFetchController: AbortController | null = null;
  private lastFloodRequestKey: string | null = null;

  private seismicLayersAdded = false;
  private seismicRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private seismicFetchController: AbortController | null = null;
  private lastSeismicRequestKey: string | null = null;

  toggleMapMode(mode: 'satellite' | 'topo') {
    this.currentMapMode.set(mode);
    if (!this.map) return;

    const isSatellite = mode === 'satellite';
    const visibility = isSatellite ? 'visible' : 'none';
    const topoVisibility = isSatellite ? 'none' : 'visible';

    if (this.map.getLayer('nz-aerial-layer')) {
      this.map.setLayoutProperty('nz-aerial-layer', 'visibility', visibility);
    }

    this.topoLayers.forEach((layerId) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', topoVisibility);
      }
    });
  }

  toggleLayer(id: string) {
    this.layers.update((currentLayers) =>
      currentLayers.map((layer) => (layer.id === id ? { ...layer, active: !layer.active } : layer)),
    );

    if (id === 'flood') {
      this.updateFloodVisibility();
    }
    if (id === 'seismic') {
      this.updateSeismicVisibility();
    }
  }

  private isLayerActive(id: string): boolean {
    return this.layers().find((l) => l.id === id)?.active ?? false;
  }

  private updateFloodVisibility() {
    if (!this.map) return;
    const active = this.isLayerActive('flood');

    if (active && !this.floodLayersAdded) {
      this.initFloodLayers(this.map);
      this.floodLayersAdded = true;
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = [
      'flood-rivers-major-layer',
      'flood-rivers-minor-layer',
      'flood-gauges-layer',
      'flood-gauges-cluster',
      'flood-gauges-count',
      'flood-plains-layer', // Coastal plains.
      'hamilton-hazard-layer', // Hamilton Flood Hazard.
    ];

    layers.forEach((layerId) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.floodFetchController) this.floodFetchController.abort();
      this.lastFloodRequestKey = null;
    }
  }

  ngOnInit() {
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: `https://basemaps.linz.govt.nz/v1/styles/topographic-v2.json?api=${environment.linzApiKey}&tileMatrix=WebMercatorQuad`,
      center: [172.5, -41.5],
      zoom: 5,
      maxBounds: NZ_BOUNDS,
    });

    this.map = map;
    map.addControl(new maplibregl.NavigationControl());

    map.on('load', () => {
      this.initBasemapLayers(map);

      map.on('moveend', () => {
        this.refreshFloodInView(map);
        this.refreshAddressesInView(map);
        this.refreshSeismicInView(map);
      });
    });
  }

  private initBasemapLayers(map: maplibregl.Map) {
    const style = map.getStyle();

    map.addSource('nz-aerial', {
      type: 'raster',
      tiles: [
        `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=${environment.linzApiKey}`,
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.linz.govt.nz/">LINZ</a>',
    });

    map.addLayer(
      {
        id: 'nz-aerial-layer',
        type: 'raster',
        source: 'nz-aerial',
        layout: { visibility: this.currentMapMode() === 'satellite' ? 'visible' : 'none' },
        paint: { 'raster-opacity': 1 },
      },
      style.layers?.[0]?.id,
    );

    this.topoLayers = [];
    style.layers?.forEach((layer) => {
      const id = layer.id.toLowerCase();
      const sl = ((layer as any)['source-layer'] || '').toLowerCase();

      if (id.startsWith('nz-')) return;

      if (layer.type === 'fill' || layer.type === 'background') {
        this.topoLayers.push(layer.id);
        if (this.currentMapMode() === 'satellite') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      }

      if (
        id.includes('address') ||
        id.includes('house') ||
        id.includes('point') ||
        id.includes('number') ||
        sl.includes('address') ||
        sl.includes('house') ||
        sl.includes('point') ||
        sl.includes('number')
      ) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });

    map.addSource('nz-addresses-arcgis', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'nz-addresses-layer',
      type: 'circle',
      source: 'nz-addresses-arcgis',
      minzoom: 15,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 18, 5],
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#2196f3',
      },
    });

    map.addLayer({
      id: 'nz-address-labels',
      type: 'symbol',
      source: 'nz-addresses-arcgis',
      minzoom: 17,
      layout: {
        'text-field': ['concat', ['get', 'full_address_number'], ' ', ['get', 'full_road_name']],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
      },
    });

    this.refreshAddressesInView(map);
  }

  private refreshAddressesInView(map: maplibregl.Map) {
    if (map.getZoom() < 15) return;
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const url = `https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Addresses/FeatureServer/0/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson&outSR=4326&resultRecordCount=1000`;

    const source = map.getSource('nz-addresses-arcgis') as maplibregl.GeoJSONSource;
    source?.setData(url);
  }

  private initFloodLayers(map: maplibregl.Map) {
    const active = this.isLayerActive('flood');

    map.addSource('flood-rivers', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addRiverNetworkLayer(map, '', active);

    map.addSource('flood-plains', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addFloodPlainsLayer(map, '', active);

    map.addSource('hamilton-hazard', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.addHamiltonHazardLayer(map, active);

    // 2. Flow Gauges Source (Clustered)
    map.addSource('flood-gauges', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 50,
    });
    this.addFlowGaugesLayer(map, '', active);

    this.bindFeatureTooltips(map);

    this.floodLayersAdded = true;
    this.refreshFloodInView(map);
  }

  private refreshFloodInView(map: maplibregl.Map) {
    if (!this.isLayerActive('flood')) return;

    if (this.floodRefreshTimeoutId) {
      clearTimeout(this.floodRefreshTimeoutId);
    }

    // Throttle flood refresh so rapid pan/zoom doesn't trigger repeated heavy requests.
    this.floodRefreshTimeoutId = setTimeout(() => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const requestKey = [
        bounds.getWest().toFixed(2),
        bounds.getSouth().toFixed(2),
        bounds.getEast().toFixed(2),
        bounds.getNorth().toFixed(2),
        Math.floor(zoom),
      ].join(':');

      if (requestKey === this.lastFloodRequestKey) return;
      this.lastFloodRequestKey = requestKey;

      if (this.floodFetchController) {
        this.floodFetchController.abort();
      }
      this.floodFetchController = new AbortController();

      this.floodService
        .getFloodInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: any) => {
            const signal = this.floodFetchController?.signal;

            if (info.gauges_url) {
              fetch(info.gauges_url, { signal })
                .then((res) => res.json())
                .then((geojson: any) => {
                  const source = map.getSource('flood-gauges') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching gauges GeoJSON:', err);
                  }
                });
            }

            if (info.rivers_url) {
              fetch(info.rivers_url, { signal })
                .then((res) => res.json())
                .then((geojson: any) => {
                  const source = map.getSource('flood-rivers') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching rivers GeoJSON:', err);
                  }
                });
            }

            const plainsSource = map.getSource('flood-plains') as maplibregl.GeoJSONSource;
            const showPlains = zoom >= 7;

            if (!showPlains) {
              plainsSource?.setData({ type: 'FeatureCollection', features: [] });
            } else if (info.plains_url) {
              fetch(info.plains_url, { signal })
                .then((res) => res.json())
                .then((geojson: any) => {
                  plainsSource?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching plains GeoJSON:', err);
                  }
                });
            }

            const hmSource = map.getSource('hamilton-hazard') as maplibregl.GeoJSONSource;
            const showHamilton = zoom >= 13;

            if (!showHamilton) {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
            } else if (info.hamilton_hazard_url) {
              this.floodService
                .getHamiltonHazardGeoJson(info.hamilton_hazard_url, signal)
                .then((geojson: any) => {
                  hmSource?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching Hamilton Hazard GeoJSON:', err);
                  }
                });
            } else {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
            }
          },
        });
    }, 250);
  }

  private updateSeismicVisibility() {
    if (!this.map) return;
    const active = this.isLayerActive('seismic');

    if (active && !this.seismicLayersAdded) {
      this.initSeismicLayers(this.map);
      this.seismicLayersAdded = true;
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = ['seismic-events-layer', 'seismic-events-cluster', 'seismic-events-count'];

    layers.forEach((layerId) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.seismicFetchController) this.seismicFetchController.abort();
      this.lastSeismicRequestKey = null;
    }
  }

  private initSeismicLayers(map: maplibregl.Map) {
    const active = this.isLayerActive('seismic');

    map.addSource('seismic-events', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 50,
    });
    this.addSeismicEventsLayer(map, active);

    this.bindFeatureTooltips(map);

    this.seismicLayersAdded = true;
    this.refreshSeismicInView(map);
  }

  private refreshSeismicInView(map: maplibregl.Map) {
    if (!this.isLayerActive('seismic')) return;

    if (this.seismicRefreshTimeoutId) {
      clearTimeout(this.seismicRefreshTimeoutId);
    }

    this.seismicRefreshTimeoutId = setTimeout(() => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const requestKey = [
        bounds.getWest().toFixed(2),
        bounds.getSouth().toFixed(2),
        bounds.getEast().toFixed(2),
        bounds.getNorth().toFixed(2),
        Math.floor(zoom),
      ].join(':');

      if (requestKey === this.lastSeismicRequestKey) return;
      this.lastSeismicRequestKey = requestKey;

      if (this.seismicFetchController) {
        this.seismicFetchController.abort();
      }
      this.seismicFetchController = new AbortController();

      this.seismicService
        .getSeismicInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: any) => {
            const signal = this.seismicFetchController?.signal;

            if (info.url) {
              fetch(info.url, { signal })
                .then((res) => res.json())
                .then((geojson: any) => {
                  const source = map.getSource('seismic-events') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching seismic GeoJSON:', err);
                  }
                });
            }
          },
        });
    }, 250);
  }

  private addSeismicEventsLayer(map: maplibregl.Map, active: boolean) {
    const visibility = active ? 'visible' : 'none';

    // Cluster Circles
    map.addLayer({
      id: 'seismic-events-cluster',
      type: 'circle',
      source: 'seismic-events',
      filter: ['has', 'point_count'],
      layout: { visibility },
      paint: {
        'circle-color': '#f97316',
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Cluster Counts
    map.addLayer({
      id: 'seismic-events-count',
      type: 'symbol',
      source: 'seismic-events',
      filter: ['has', 'point_count'],
      layout: {
        visibility,
        'text-field': '{point_count}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
      },
    });

    // Individual Points
    map.addLayer({
      id: 'seismic-events-layer',
      type: 'circle',
      source: 'seismic-events',
      filter: ['!', ['has', 'point_count']],
      layout: { visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 12],
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'magnitude'],
          0,
          '#fed7aa',
          3,
          '#fdba74',
          4,
          '#f97316',
          5,
          '#ea580c',
          6,
          '#c2410c',
          7,
          '#7c2d12',
          9,
          '#431407',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }

  private addHamiltonHazardLayer(map: maplibregl.Map, active: boolean) {
    map.addLayer({
      id: 'hamilton-hazard-layer',
      type: 'fill',
      source: 'hamilton-hazard',
      minzoom: 13,
      layout: { visibility: active ? 'visible' : 'none' },
      paint: {
        'fill-color': [
          'match',
          ['get', 'Hazard_Factor'],
          'Low',
          '#facc15',
          'Medium',
          '#fb923c',
          'High',
          '#ef4444',
          '#ef4444',
        ],
        'fill-opacity': 0.55,
        'fill-outline-color': [
          'match',
          ['get', 'Hazard_Factor'],
          'Low',
          '#ca8a04',
          'Medium',
          '#c2410c',
          'High',
          '#b91c1c',
          '#b91c1c',
        ],
      },
    });
  }

  private addRiverNetworkLayer(map: maplibregl.Map, url: string, active: boolean) {
    // Major rivers (Stream order > 3) - shown at all zoom levels
    map.addLayer({
      id: 'flood-rivers-major-layer',
      type: 'line',
      source: 'flood-rivers',
      filter: ['>', ['to-number', ['get', 'Strm_Order']], 3],
      layout: {
        visibility: active ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#2196f3',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          ['*', 0.4, ['to-number', ['get', 'Strm_Order']]],
          10,
          ['*', 0.8, ['to-number', ['get', 'Strm_Order']]],
          15,
          ['*', 1.2, ['to-number', ['get', 'Strm_Order']]],
        ],
        'line-opacity': 0.9,
      },
    });

    // Minor rivers (Stream order 1 to 3) - only shown when zoomed in (>= 11)
    map.addLayer({
      id: 'flood-rivers-minor-layer',
      type: 'line',
      source: 'flood-rivers',
      minzoom: 11,
      filter: ['<=', ['to-number', ['get', 'Strm_Order']], 3],
      layout: {
        visibility: active ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#42a5f5',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['*', 0.5, ['to-number', ['get', 'Strm_Order']]],
          15,
          ['*', 1.0, ['to-number', ['get', 'Strm_Order']]],
        ],
        'line-opacity': 0.8,
      },
    });
  }

  private addFloodPlainsLayer(map: maplibregl.Map, url: string, active: boolean) {
    map.addLayer({
      id: 'flood-plains-layer',
      type: 'fill',
      source: 'flood-plains',
      minzoom: 7,
      layout: { visibility: active ? 'visible' : 'none' },
      paint: {
        'fill-color': '#60a5fa',
        'fill-opacity': 0.18,
        'fill-outline-color': '#2563eb',
      },
    });
  }

  private addFlowGaugesLayer(map: maplibregl.Map, url: string, active: boolean) {
    const visibility = active ? 'visible' : 'none';

    // Cluster Circles
    map.addLayer({
      id: 'flood-gauges-cluster',
      type: 'circle',
      source: 'flood-gauges',
      filter: ['has', 'point_count'],
      layout: { visibility: visibility },
      paint: {
        'circle-color': '#ff9800',
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Cluster Counts
    map.addLayer({
      id: 'flood-gauges-count',
      type: 'symbol',
      source: 'flood-gauges',
      filter: ['has', 'point_count'],
      layout: {
        visibility: visibility,
        'text-field': '{point_count}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
      },
    });

    // Individual Points
    map.addLayer({
      id: 'flood-gauges-layer',
      type: 'circle',
      source: 'flood-gauges',
      filter: ['!', ['has', 'point_count']],
      layout: { visibility: visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 12],
        'circle-color': '#ff5722',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }

  private tooltipHandlersBound = false;

  private bindFeatureTooltips(map: maplibregl.Map) {
    if (this.tooltipHandlersBound) return;

    const interactiveLayers = [
      'flood-plains-layer',
      'flood-rivers-major-layer',
      'flood-rivers-minor-layer',
      'flood-gauges-layer',
      'hamilton-hazard-layer',
      'seismic-events-layer',
    ] as const;

    const showPopup = (
      e: maplibregl.MapLayerMouseEvent,
      layerId:
        | 'flood-plains-layer'
        | 'flood-rivers-major-layer'
        | 'flood-rivers-minor-layer'
        | 'flood-gauges-layer'
        | 'hamilton-hazard-layer'
        | 'seismic-events-layer',
    ) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = (feature.properties || {}) as Record<string, unknown>;
      const lines = this.getTooltipLines(layerId, props);

      if (lines.length > 0) {
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true }).setLngLat(
          e.lngLat,
        );

        if (layerId === 'flood-gauges-layer') {
          const container = document.createElement('div');
          container.innerHTML = lines.join('<br/>');

          const btnContainer = document.createElement('div');
          btnContainer.className = 'mt-2';

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.style.cssText =
            'background-color: #2563eb; color: white; padding: 4px 12px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; font-size: 12px; pointer-events: auto;';
          btn.innerText = 'More Details';

          btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            console.log('Gauge Details button clicked!', props);
            this.ngZone.run(() => {
              this.selectedGauge.set(props as unknown as GaugeProperties);
            });
            popup.remove(); // Safely remove the popup now that it triggers inside NgZone
          };

          btn.onmousedown = (ev) => {
            ev.stopPropagation();
          };
          btn.onmouseup = (ev) => {
            ev.stopPropagation();
          };
          btn.ontouchstart = (ev) => {
            ev.stopPropagation();
          };
          btn.ontouchend = (ev) => {
            ev.stopPropagation();
          };
          btn.onpointerdown = (ev) => {
            ev.stopPropagation();
          };
          btn.onpointerup = (ev) => {
            ev.stopPropagation();
          };

          btnContainer.appendChild(btn);
          container.appendChild(btnContainer);

          popup.setDOMContent(container);
        } else {
          popup.setHTML(lines.join('<br/>'));
        }

        popup.addTo(map);
      }
    };

    interactiveLayers.forEach((layerId) => {
      map.on('click', layerId, (e) => showPopup(e, layerId));
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    });

    this.tooltipHandlersBound = true;
  }

  private getTooltipLines(
    layerId:
      | 'flood-plains-layer'
      | 'flood-rivers-major-layer'
      | 'flood-rivers-minor-layer'
      | 'flood-gauges-layer'
      | 'hamilton-hazard-layer'
      | 'seismic-events-layer',
    props: Record<string, unknown>,
  ): string[] {
    if (layerId === 'seismic-events-layer') {
      const title = '<b>Seismic Event</b>';
      const mag = this.pickFirstValue(props, ['magnitude']);
      const depth = this.pickFirstValue(props, ['depth']);
      const time = this.pickFirstValue(props, ['origintime']);
      const output = [title];
      if (mag) output.push(`Magnitude: ${mag}`);
      if (depth) output.push(`Depth: ${depth} km`);
      if (time) output.push(`Time: ${new Date(time).toLocaleString()}`);
      return output;
    }
    if (layerId === 'hamilton-hazard-layer') {
      const title = '<b>Hamilton Flood Hazard</b>';
      const factor = this.pickFirstValue(props, ['Hazard_Factor']);
      const event = this.pickFirstValue(props, ['Storm_Event']);
      const output = [title];
      if (factor) output.push(`Hazard Factor: ${factor}`);
      if (event) output.push(`Storm Event: ${event}`);
      return output;
    }
    if (layerId === 'flood-rivers-major-layer' || layerId === 'flood-rivers-minor-layer') {
      const title = '<b>River Network</b>';
      const name = this.pickFirstValue(props, ['Rivername', 'name', 'River']);
      const order = this.pickFirstValue(props, ['Strm_Order', 'stream_order']);
      const flow = this.pickFirstValue(props, ['q100_reach']);
      const output = [title];
      if (name && name.trim() !== '') output.push(`Name: ${name}`);
      if (order) output.push(`Stream Order: ${order}`);
      if (flow) output.push(`Q100 Flow: ${flow}`);
      return output.length > 1 ? output : [title];
    }

    if (layerId === 'flood-plains-layer') {
      const title = '<b>Coastal Flood Plain</b>';
      const detail = this.pickFirstValue(props, [
        'HazardType',
        'hazard_type',
        'Type',
        'Category',
        'gridcode',
      ]);
      const depth = this.pickFirstValue(props, ['Depth_m', 'depth', 'DEPTH']);
      const output = [title];
      if (detail && detail.trim() !== '') output.push(`Class: ${detail}`);
      if (depth) output.push(`Depth: ${depth} m`);
      return output.length > 1 ? output : [title];
    }

    if (layerId === 'flood-gauges-layer') {
      const title = '<b>Flow Gauge</b>';
      const name = this.pickFirstValue(props, ['site_name', 'SiteName', 'Location', 'Name']);
      const owner = this.pickFirstValue(props, ['owner', 'Owner', 'Council']);
      const output = [title];
      if (name && name.trim() !== '') output.push(`Name: ${name}`);
      if (owner) output.push(`Owner: ${owner}`);

      return output;
    }

    return [];
  }

  private pickFirstValue(props: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = props[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        return `${value}`;
      }
    }
    return null;
  }
}
