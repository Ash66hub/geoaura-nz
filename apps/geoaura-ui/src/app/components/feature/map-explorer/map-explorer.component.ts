import {
  Component,
  OnInit,
  ElementRef,
  viewChild,
  inject,
  signal,
  computed,
  NgZone,
} from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { LngLatBoundsLike } from 'maplibre-gl';
import { environment } from '../../../../environments/environment';
import { FloodService } from '../../../services/flood.service';
import { AddressSuggestion, PropertyService } from '../../../services/property.service';
import { SeismicService } from '../../../services/seismic.service';
import { CommonModule } from '@angular/common';
import { GaugeModalComponent } from '../flood-flow-gauge/gauge-modal/gauge-modal.component';
import { AddressSearchComponent } from '../../shared/address-search/address-search.component';
import { DetailPanelComponent, DetailPanelModel } from '../detail-panel/detail-panel.component';
import { GaugeProperties, LayerItem } from '../../../common/flood-flow-gauge';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

const NZ_BOUNDS: LngLatBoundsLike = [
  [165.0, -48.5],
  [179.5, -33.0],
];

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  imports: [CommonModule, GaugeModalComponent, AddressSearchComponent, DetailPanelComponent],
  templateUrl: './map-explorer.component.html',
  styleUrl: './map-explorer.component.scss',
})
export class MapExplorerComponent implements OnInit {
  private static readonly PROPERTY_BOUNDARY_SOURCE_ID = 'property-boundary-source';
  private static readonly PROPERTY_BOUNDARY_FILL_LAYER_ID = 'property-boundary-fill';
  private static readonly PROPERTY_BOUNDARY_LINE_LAYER_ID = 'property-boundary-line';

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
  zoomLevel = signal(5);
  selectedLayerId = signal<string | null>(null);
  isDetailPanelMinimized = signal(false);
  floodOverviewLoading = signal(false);
  floodGaugesLoading = signal(false);
  floodPlainsLoading = signal(false);
  floodRiversLoading = signal(false);
  seismicDataLoading = signal(false);
  seismicFaultLinesLoading = signal(false);

  detailPanelModel = computed<DetailPanelModel | null>(() => {
    try {
      const selId = this.selectedLayerId();
      if (!selId) return null;

      const layer = this.layers().find((l) => l.id === selId);
      if (!layer || !layer.active) return null;

      if (selId === 'flood') {
        return {
          id: 'flood',
          title: 'Flood Risk',
          icon: 'water_damage',
          color: '#60a5fa',
          sections: [
            {
              title: 'Flood Risk Overview',
              description:
                'Appears at Zoom levels beyond 13. Shows areas prone to flooding scenarios mapping to a 1-in-100 year event. Considers historical mapping, soil models, and low-lying topography. Currently only available for Hamilton.',
              source: 'Waikato Regional Council',
              symbolType: 'fill-hazard',
              loading: this.floodOverviewLoading(),
            },
            {
              title: 'Flow Gauges',
              description:
                'Live telemetered flow gauges actively measuring river height and discharge across the network in real time.',
              source: 'LINZ & Regional Councils',
              symbolType: 'point-gauge',
              loading: this.floodGaugesLoading(),
            },
            {
              title: 'Coastal Plains',
              description:
                'Vulnerable coastal areas and tidal estuaries combining sea-level events with heavy rain displacement causing dual-boundary risk.',
              source: 'NIWA',
              symbolType: 'fill-flood',
              loading: this.floodPlainsLoading(),
            },
            {
              title: 'River Network',
              description:
                'Trunk waterways and tributary boundaries expected to overtop beyond standard channel capacity.',
              source: 'LINZ',
              symbolType: 'line-river',
              loading: this.floodRiversLoading(),
            },
          ],
        };
      } else if (selId === 'seismic') {
        return {
          id: 'seismic',
          title: 'Seismic Events',
          icon: 'waves',
          color: '#fb923c',
          sections: [
            {
              title: 'Recent Earthquakes',
              description:
                'Recent recorded seismic activity highlighting magnitude and depth. Darker points indicate stronger quakes.',
              source: 'GeoNet',
              symbolType: 'point-seismic',
              loading: this.seismicDataLoading(),
            },
            {
              title: 'Fault Lines',
              description:
                'Major mapped active fault lines that pose elevated rupture risks to surrounding districts.',
              source: 'GNS Science',
              symbolType: 'line-fault',
              loading: this.seismicFaultLinesLoading(),
            },
          ],
        };
      } else {
        return {
          id: layer.id,
          title: layer.name,
          icon: layer.icon,
          color: '#64748b',
          placeholder: true,
          sections: [],
        };
      }
    } catch (e) {
      console.error('Error computing detail panel model', e);
      return null;
    }
  });

  private topoLayers: string[] = [];
  private map?: maplibregl.Map;
  private floodLayersAdded = false;
  private floodRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private floodFetchController: AbortController | null = null;
  private lastFloodRequestKey: string | null = null;
  private floodLoadCycleId = 0;

  private seismicLayersAdded = false;
  private seismicRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private seismicFetchController: AbortController | null = null;
  private lastSeismicRequestKey: string | null = null;
  private seismicLoadCycleId = 0;
  private searchResultMarker: maplibregl.Marker | null = null;
  private boundaryLookupRequestId = 0;
  private boundaryCandidateLayerIds: string[] = [];

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

    const isNowActive = this.isLayerActive(id);
    if (isNowActive) {
      this.selectedLayerId.set(id);
      this.isDetailPanelMinimized.set(false);
    } else if (this.selectedLayerId() === id) {
      const remainingActive = this.layers().filter((l) => l.active);
      if (remainingActive.length > 0) {
        // Fall back to most recently active layer in the remaining list (or just the first one we find)
        this.selectedLayerId.set(remainingActive[remainingActive.length - 1].id);
        this.isDetailPanelMinimized.set(false);
      } else {
        this.selectedLayerId.set(null);
        this.isDetailPanelMinimized.set(false);
      }
    }

    if (id === 'flood') {
      this.updateFloodVisibility();
    }
    if (id === 'seismic') {
      this.updateSeismicVisibility();
    }
  }

  toggleDetailPanelMinimized() {
    this.isDetailPanelMinimized.update((v) => !v);
  }

  private isLayerActive(id: string): boolean {
    return this.layers().find((l) => l.id === id)?.active ?? false;
  }

  onAddressSelected(suggestion: AddressSuggestion) {
    if (!this.map) return;

    this.map.flyTo({
      center: [suggestion.lng, suggestion.lat],
      zoom: 19,
      speed: 1.5,
      essential: true,
    });

    this.setSelectionBlip(suggestion.lng, suggestion.lat);

    this.map.once('moveend', () => {
      this.highlightPropertyBoundaryAt(suggestion.lat, suggestion.lng);
    });
  }

  private setSelectionBlip(lng: number, lat: number) {
    if (!this.map) return;

    if (!this.searchResultMarker) {
      const markerRoot = document.createElement('div');
      markerRoot.style.position = 'relative';
      markerRoot.style.width = '18px';
      markerRoot.style.height = '18px';

      const pulse = document.createElement('div');
      pulse.style.position = 'absolute';
      pulse.style.left = '50%';
      pulse.style.top = '50%';
      pulse.style.width = '28px';
      pulse.style.height = '28px';
      pulse.style.borderRadius = '50%';
      pulse.style.border = '2px solid rgba(31, 224, 202, 0.8)';
      pulse.style.transform = 'translate(-50%, -50%)';

      pulse.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0.85 },
          { transform: 'translate(-50%, -50%) scale(1.8)', opacity: 0 },
        ],
        { duration: 1400, iterations: Infinity, easing: 'ease-out' },
      );

      const core = document.createElement('div');
      core.style.position = 'absolute';
      core.style.left = '50%';
      core.style.top = '50%';
      core.style.width = '12px';
      core.style.height = '12px';
      core.style.borderRadius = '50%';
      core.style.background = '#1fe0ca';
      core.style.boxShadow = '0 0 0 2px #0f172a';
      core.style.transform = 'translate(-50%, -50%)';

      markerRoot.appendChild(pulse);
      markerRoot.appendChild(core);

      this.searchResultMarker = new maplibregl.Marker({ element: markerRoot, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
    } else {
      this.searchResultMarker.setLngLat([lng, lat]);
    }
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
      this.floodOverviewLoading.set(false);
      this.floodGaugesLoading.set(false);
      this.floodPlainsLoading.set(false);
      this.floodRiversLoading.set(false);
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

    this.zoomLevel.set(Number(map.getZoom().toFixed(1)));
    map.on('zoom', () => {
      this.ngZone.run(() => {
        this.zoomLevel.set(Number(map.getZoom().toFixed(1)));
      });
    });

    map.on('load', () => {
      this.initBasemapLayers(map);
      this.initPropertyBoundaryLayers(map);

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
    this.boundaryCandidateLayerIds = [];
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

      const isBoundaryCandidate =
        (layer.type === 'fill' || layer.type === 'line') &&
        (id.includes('parcel') ||
          id.includes('cadastre') ||
          id.includes('property') ||
          id.includes('title') ||
          sl.includes('parcel') ||
          sl.includes('cadastre') ||
          sl.includes('property') ||
          sl.includes('title'));

      if (isBoundaryCandidate) {
        this.boundaryCandidateLayerIds.push(layer.id);
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

    this.bindAddressCircleInteractions(map);

    this.refreshAddressesInView(map);
  }

  private bindAddressCircleInteractions(map: maplibregl.Map) {
    map.on('mouseenter', 'nz-addresses-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'nz-addresses-layer', () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', 'nz-addresses-layer', (e) => {
      const feature = e.features?.[0];
      this.highlightPropertyBoundaryFromFeatureOrClick(feature, e.lngLat.lng, e.lngLat.lat);
    });
  }

  private highlightPropertyBoundaryFromFeatureOrClick(
    feature: maplibregl.MapGeoJSONFeature | undefined,
    fallbackLng: number,
    fallbackLat: number,
  ) {
    const geometry = feature?.geometry;

    if (geometry?.type === 'Point') {
      const [lng, lat] = geometry.coordinates;
      this.setSelectionBlip(lng, lat);
      this.highlightPropertyBoundaryAt(lat, lng);
      return;
    }

    this.setSelectionBlip(fallbackLng, fallbackLat);
    this.highlightPropertyBoundaryAt(fallbackLat, fallbackLng);
  }

  private initPropertyBoundaryLayers(map: maplibregl.Map) {
    if (!map.getSource(MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID)) {
      map.addSource(MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!map.getLayer(MapExplorerComponent.PROPERTY_BOUNDARY_FILL_LAYER_ID)) {
      map.addLayer({
        id: MapExplorerComponent.PROPERTY_BOUNDARY_FILL_LAYER_ID,
        type: 'fill',
        source: MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID,
        paint: {
          'fill-color': '#14b8a6',
          'fill-opacity': 0.14,
        },
      });
    }

    if (!map.getLayer(MapExplorerComponent.PROPERTY_BOUNDARY_LINE_LAYER_ID)) {
      map.addLayer({
        id: MapExplorerComponent.PROPERTY_BOUNDARY_LINE_LAYER_ID,
        type: 'line',
        source: MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID,
        paint: {
          'line-color': '#14b8a6',
          'line-width': 3,
        },
      });
    }
  }

  private highlightPropertyBoundaryAt(lat: number, lng: number) {
    if (!this.map) return;

    const requestId = ++this.boundaryLookupRequestId;
    this.propertyService
      .getParcelGeometry(lat, lng)
      .pipe(catchError(() => of(null)))
      .subscribe((feature) => {
        if (!this.map || requestId !== this.boundaryLookupRequestId) return;

        const source = this.map.getSource(
          MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID,
        ) as maplibregl.GeoJSONSource;
        if (!source) return;

        if (!feature) {
          if (!this.highlightBoundaryFromRenderedLayers(lat, lng)) {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
          return;
        }

        source.setData({
          type: 'FeatureCollection',
          features: [feature],
        });
      });
  }

  private highlightBoundaryFromRenderedLayers(lat: number, lng: number): boolean {
    if (!this.map || this.boundaryCandidateLayerIds.length === 0) return false;

    const pixel = this.map.project([lng, lat]);
    const candidates = this.map.queryRenderedFeatures(
      [
        [pixel.x - 4, pixel.y - 4],
        [pixel.x + 4, pixel.y + 4],
      ],
      {
        layers: this.boundaryCandidateLayerIds,
      },
    );

    const polygons = candidates.filter(
      (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
    );
    const boundary =
      polygons.find((f) => this.geometryContainsPoint(f.geometry, lng, lat)) ?? polygons[0];

    if (!boundary || !boundary.geometry) {
      return false;
    }

    const source = this.map.getSource(
      MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID,
    ) as maplibregl.GeoJSONSource;
    if (!source) return false;

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: boundary.geometry,
          properties: boundary.properties || {},
        },
      ],
    });

    return true;
  }

  private geometryContainsPoint(
    geometry: GeoJSON.Geometry | null | undefined,
    lng: number,
    lat: number,
  ): boolean {
    if (!geometry) return false;

    if (geometry.type === 'Polygon') {
      return this.polygonContainsPoint(geometry.coordinates, lng, lat);
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some((polygon) => this.polygonContainsPoint(polygon, lng, lat));
    }

    return false;
  }

  private polygonContainsPoint(polygon: number[][][], lng: number, lat: number): boolean {
    if (polygon.length === 0) return false;

    const insideOuter = this.ringContainsPoint(polygon[0], lng, lat);
    if (!insideOuter) return false;

    for (let i = 1; i < polygon.length; i++) {
      if (this.ringContainsPoint(polygon[i], lng, lat)) {
        return false;
      }
    }

    return true;
  }

  private ringContainsPoint(ring: number[][], lng: number, lat: number): boolean {
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
    if (!this.isLayerActive('flood')) {
      this.floodOverviewLoading.set(false);
      this.floodGaugesLoading.set(false);
      this.floodPlainsLoading.set(false);
      this.floodRiversLoading.set(false);
      return;
    }

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

      const cycleId = ++this.floodLoadCycleId;

      this.floodService
        .getFloodInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: {
            gauges_url?: string;
            rivers_url?: string;
            plains_url?: string;
            hamilton_hazard_url?: string;
          }) => {
            const signal = this.floodFetchController?.signal;

            if (info.gauges_url) {
              this.floodGaugesLoading.set(true);
              fetch(info.gauges_url, { signal })
                .then((res) => res.json())
                .then((geojson: GeoJSON.GeoJSON) => {
                  const source = map.getSource('flood-gauges') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching gauges GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.floodLoadCycleId) {
                    this.floodGaugesLoading.set(false);
                  }
                });
            } else {
              this.floodGaugesLoading.set(false);
            }

            if (info.rivers_url) {
              this.floodRiversLoading.set(true);
              fetch(info.rivers_url, { signal })
                .then((res) => res.json())
                .then((geojson: GeoJSON.GeoJSON) => {
                  const source = map.getSource('flood-rivers') as maplibregl.GeoJSONSource;
                  source?.setData(geojson);
                })
                .catch((err) => {
                  if (err?.name !== 'AbortError') {
                    console.error('Error fetching rivers GeoJSON:', err);
                  }
                })
                .finally(() => {
                  if (cycleId === this.floodLoadCycleId) {
                    this.floodRiversLoading.set(false);
                  }
                });
            } else {
              this.floodRiversLoading.set(false);
            }

            const plainsSource = map.getSource('flood-plains') as maplibregl.GeoJSONSource;
            const showPlains = zoom >= 7;

            if (!showPlains) {
              plainsSource?.setData({ type: 'FeatureCollection', features: [] });
              this.floodPlainsLoading.set(false);
            } else if (info.plains_url) {
              this.floodPlainsLoading.set(true);
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
                  if (cycleId === this.floodLoadCycleId) {
                    this.floodPlainsLoading.set(false);
                  }
                });
            } else {
              this.floodPlainsLoading.set(false);
            }

            const hmSource = map.getSource('hamilton-hazard') as maplibregl.GeoJSONSource;
            const showHamilton = zoom >= 13;

            if (!showHamilton) {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
              this.floodOverviewLoading.set(false);
            } else if (info.hamilton_hazard_url) {
              this.floodOverviewLoading.set(true);
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
                  if (cycleId === this.floodLoadCycleId) {
                    this.floodOverviewLoading.set(false);
                  }
                });
            } else {
              hmSource?.setData({ type: 'FeatureCollection', features: [] });
              this.floodOverviewLoading.set(false);
            }
          },
          error: () => {
            if (cycleId === this.floodLoadCycleId) {
              this.floodOverviewLoading.set(false);
              this.floodGaugesLoading.set(false);
              this.floodPlainsLoading.set(false);
              this.floodRiversLoading.set(false);
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
    const layers = [
      'seismic-events-layer',
      'seismic-events-cluster',
      'seismic-events-count',
      'seismic-fault-lines-layer',
    ];

    layers.forEach((layerId) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });

    if (!active) {
      if (this.seismicFetchController) this.seismicFetchController.abort();
      this.lastSeismicRequestKey = null;
      this.seismicDataLoading.set(false);
      this.seismicFaultLinesLoading.set(false);
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

    map.addSource('seismic-fault-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.addSeismicFaultLinesLayer(map, active);
    this.addSeismicEventsLayer(map, active);

    this.bindFeatureTooltips(map);

    this.seismicLayersAdded = true;
    this.refreshSeismicInView(map);
  }

  private refreshSeismicInView(map: maplibregl.Map) {
    if (!this.isLayerActive('seismic')) {
      this.seismicDataLoading.set(false);
      this.seismicFaultLinesLoading.set(false);
      return;
    }

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

      const loadingId = ++this.seismicLoadCycleId;
      this.seismicDataLoading.set(true);

      this.seismicService
        .getSeismicInfoForExtent(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        )
        .subscribe({
          next: (info: {
            url?: string;
            fault_lines_url?: string;
            fault_lines_highres_url?: string;
          }) => {
            const signal = this.seismicFetchController?.signal;
            const tasks: Promise<unknown>[] = [];

            if (info.url) {
              tasks.push(
                fetch(info.url, { signal })
                  .then((res) => res.json())
                  .then((geojson: GeoJSON.GeoJSON) => {
                    const source = map.getSource('seismic-events') as maplibregl.GeoJSONSource;
                    source?.setData(geojson);
                  })
                  .catch((err) => {
                    if (err?.name !== 'AbortError') {
                      console.error('Error fetching seismic GeoJSON:', err);
                    }
                  }),
              );
            } else {
              const source = map.getSource('seismic-events') as maplibregl.GeoJSONSource;
              source?.setData({ type: 'FeatureCollection', features: [] });
            }

            const faultUrl =
              zoom >= 13
                ? info.fault_lines_highres_url || info.fault_lines_url
                : info.fault_lines_url;
            const shouldFallbackToRegionalFaults =
              zoom >= 13 &&
              !!info.fault_lines_highres_url &&
              !!info.fault_lines_url &&
              info.fault_lines_highres_url !== info.fault_lines_url;
            if (faultUrl) {
              this.seismicFaultLinesLoading.set(true);
              tasks.push(
                fetch(faultUrl, { signal })
                  .then((res) => res.json())
                  .then(async (geojson: GeoJSON.GeoJSON) => {
                    const source = map.getSource('seismic-fault-lines') as maplibregl.GeoJSONSource;

                    const featureCount =
                      geojson &&
                      'features' in geojson &&
                      Array.isArray((geojson as GeoJSON.FeatureCollection).features)
                        ? (geojson as GeoJSON.FeatureCollection).features.length
                        : 0;

                    if (
                      shouldFallbackToRegionalFaults &&
                      featureCount === 0 &&
                      info.fault_lines_url
                    ) {
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
                    if (loadingId === this.seismicLoadCycleId) {
                      this.seismicFaultLinesLoading.set(false);
                    }
                  }),
              );
            } else {
              const source = map.getSource('seismic-fault-lines') as maplibregl.GeoJSONSource;
              source?.setData({ type: 'FeatureCollection', features: [] });
              this.seismicFaultLinesLoading.set(false);
            }

            Promise.allSettled(tasks).finally(() => {
              if (loadingId === this.seismicLoadCycleId) {
                this.seismicDataLoading.set(false);
              }
            });
          },
          error: () => {
            if (loadingId === this.seismicLoadCycleId) {
              this.seismicDataLoading.set(false);
              this.seismicFaultLinesLoading.set(false);
            }
          },
        });
    }, 250);
  }

  private addSeismicFaultLinesLayer(map: maplibregl.Map, active: boolean) {
    map.addLayer({
      id: 'seismic-fault-lines-layer',
      type: 'line',
      source: 'seismic-fault-lines',
      layout: {
        visibility: active ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#ef4444',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.8, 14, 2.8],
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    });
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
      'seismic-fault-lines-layer',
    ] as const;

    const showPopup = (
      e: maplibregl.MapLayerMouseEvent,
      layerId:
        | 'flood-plains-layer'
        | 'flood-rivers-major-layer'
        | 'flood-rivers-minor-layer'
        | 'flood-gauges-layer'
        | 'hamilton-hazard-layer'
        | 'seismic-events-layer'
        | 'seismic-fault-lines-layer',
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
      | 'seismic-events-layer'
      | 'seismic-fault-lines-layer',
    props: Record<string, unknown>,
  ): string[] {
    if (layerId === 'seismic-fault-lines-layer') {
      const title = '<b>Active Fault Line</b>';
      const name = this.pickFirstValue(props, ['name', 'NAME', 'Name', 'FAULT_NAME', 'FaultName']);
      const className = this.pickFirstValue(props, ['CLASS', 'Class']);
      const age = this.pickFirstValue(props, ['AGE', 'Age']);
      const output = [title];
      if (name) output.push(`Name: ${name}`);
      if (className) output.push(`Class: ${className}`);
      if (age) output.push(`Age: ${age}`);
      return output;
    }

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
