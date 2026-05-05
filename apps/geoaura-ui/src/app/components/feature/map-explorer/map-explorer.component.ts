import {
  Component,
  OnInit,
  ElementRef,
  viewChild,
  inject,
  signal,
  computed,
  NgZone,
  effect,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { of, Subscription } from 'rxjs';
import { finalize, switchMap, catchError } from 'rxjs/operators';
import * as maplibregl from 'maplibre-gl';
import { LngLatBoundsLike } from 'maplibre-gl';
import { environment } from '../../../../environments/environment';
import { FloodService } from '../../../services/flood.service';
import { TrafficService } from '../../../services/traffic.service';
import {
  AddressSuggestion,
  PropertyService,
  PropertySummary,
} from '../../../services/property.service';
import { SeismicService } from '../../../services/seismic.service';
import { ReportService } from '../../../services/report.service';
import { CommonModule } from '@angular/common';
import { GaugeModalComponent } from '../flood-flow-gauge/gauge-modal/gauge-modal.component';
import { AddressSearchComponent } from '../../shared/address-search/address-search.component';
import {
  DetailPanelComponent,
  DetailPanelInfoMode,
  DetailPanelModel,
} from '../detail-panel/detail-panel.component';
import { PoliceService } from '../../../services/police.service';
import { GaugeProperties, LayerItem } from '../../../common/flood-flow-gauge';
import {
  getTooltipLines,
  parseCrimeBreakdown,
  type InteractiveLayerId,
} from './map-explorer.utils';
import { PoliceLayerController } from './police-layer.controller';
import { SeismicLayerController } from './seismic-layer.controller';
import { FloodLayerController } from './flood-layer.controller';
import { TrafficLayerController } from './traffic-layer.controller';
import { PropertySelectionController } from './property-selection.controller';
import { buildPropertyDetailModel } from './property-detail.model';
import { RentService, RentStatistics } from '../../../services/rent.service';
import { RentLayerController } from './rent-layer.controller';
import { FloodDataService } from '../../../services/flood-data.service';

const NZ_BOUNDS: LngLatBoundsLike = [
  [165.0, -48.5],
  [179.5, -33.0],
];
const POLICE_MIN_ZOOM = 12;

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  imports: [CommonModule, GaugeModalComponent, AddressSearchComponent, DetailPanelComponent],
  templateUrl: './map-explorer.component.html',
  styleUrl: './map-explorer.component.scss',
})
export class MapExplorerComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PROPERTY_BOUNDARY_SOURCE_ID = 'property-boundary-source';
  private static readonly PROPERTY_BOUNDARY_FILL_LAYER_ID = 'property-boundary-fill';
  private static readonly PROPERTY_BOUNDARY_LINE_LAYER_ID = 'property-boundary-line';

  private mapContainer = viewChild<ElementRef>('mapContainer');
  private floodService = inject(FloodService);
  private floodDataService = inject(FloodDataService);
  private trafficService = inject(TrafficService);
  private seismicService = inject(SeismicService);
  private propertyService = inject(PropertyService);
  private ngZone = inject(NgZone);
  private policeService = inject(PoliceService);
  private rentService = inject(RentService);
  public reportService = inject(ReportService);
  
  isMobileControlsOpen = signal(false);

  toggleMobileControls() {
    this.isMobileControlsOpen.update(v => !v);
  }

  constructor() {
    effect(() => {
      const isLocked = this.reportService.isSelectorOpen() || !!this.reportService.currentReport();
      this.toggleMapInteractions(!isLocked);
    });
  }

  selectedGauge = signal<GaugeProperties | null>(null);
  selectedPoliceMeshblock = signal<Record<string, unknown> | null>(null);
  policeDataLoading = signal(false);
  private hoverTimeout: any;

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
      name: 'Market Rent',
      icon: 'real_estate_agent',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-emerald-500',
    },
    {
      id: 'police',
      name: 'Police Incidents',
      icon: 'local_police',
      active: false,
      colorClass: 'primary',
      iconColorClass: 'text-police-red',
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
  trafficDataLoading = signal(false);
  trafficHamiltonDataLoading = signal(false);
  rentDataLoading = signal(false);
  selectedRentArea = signal<string | null>(null);
  rentStatistics = signal<RentStatistics | null>(null);
  rentStatsLoading = signal(false);
  selectedPropertySummary = signal<PropertySummary | null>(null);
  selectedPropertyCoords = signal<{ lat: number; lng: number } | null>(null);
  propertyLoading = signal(false);
  propertyLoadError = signal<string | null>(null);
  panelInfoMode = signal<DetailPanelInfoMode>('layer');
  showDetailInfoToggle = computed(() => {
    const hasPropertyContext =
      !!this.selectedPropertySummary() ||
      !!this.selectedPropertyCoords() ||
      this.propertyLoading() ||
      !!this.propertyLoadError();

    return !this.isDetailPanelMinimized() && hasPropertyContext && this.hasActiveLayerSelection();
  });

  detailPanelModel = computed<DetailPanelModel | null>(() => {
    try {
      const preferProperty = this.panelInfoMode() === 'property' || !this.hasActiveLayerSelection();
      const propertyCoords = this.selectedPropertyCoords();
      const propertyModel = buildPropertyDetailModel({
        propertyCoords,
        preferProperty,
        propertyLoading: this.propertyLoading(),
        summary: this.selectedPropertySummary(),
        propertyLoadError: this.propertyLoadError(),
      });
      if (propertyModel) {
        return propertyModel;
      }

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
              source: 'LINZ',
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
      } else if (selId === 'traffic') {
        return {
          id: 'traffic',
          title: 'Traffic Volume',
          icon: 'traffic',
          color: '#0ea5e9',
          sections: [
            {
              title: 'Annual Average Daily Traffic (AADT)',
              description:
                'State highway line segments are color-coded by average daily vehicle count. Higher AADT indicates heavier corridor pressure and more frequent congestion.',
              source: 'NZTA Waka Kotahi',
              symbolType: 'line-traffic-bin-3',
              legendItems: [
                { label: 'Very Low (< 5,000)', symbolType: 'line-traffic-bin-1' },
                { label: 'Low-Medium (5,000-10,000)', symbolType: 'line-traffic-bin-2' },
                { label: 'Medium (10,000-20,000)', symbolType: 'line-traffic-bin-3' },
                { label: 'High (20,000-35,000)', symbolType: 'line-traffic-bin-4' },
                { label: 'Very High (> 35,000)', symbolType: 'line-traffic-bin-5' },
              ],
              loading: this.trafficDataLoading(),
            },
            {
              title: 'Hamilton Traffic Count Sites',
              description:
                'Hamilton City count sites are shown as points using the most recent AADT-equivalent annual traffic count available (Year2023, then Year2022, and earlier years as fallback).',
              source: 'Hamilton City Council',
              symbolType: 'point-traffic-hamilton',
              loading: this.trafficHamiltonDataLoading(),
            },
          ],
        };
      } else if (selId === 'police') {
        const meshblock = this.selectedPoliceMeshblock();
        const crimeBreakdown = parseCrimeBreakdown(meshblock?.['crime_breakdown']);
        const crimeData = Object.entries(crimeBreakdown)
          .map(([label, value]) => ({ label, value: Number(value) || 0 }))
          .filter((item) => item.value > 0)
          .sort((a, b) => b.value - a.value);

        return {
          id: 'police',
          title: 'Police Incidents',
          icon: 'local_police',
          color: '#ef4444',
          sections: [
            {
              title: 'Incident Density',
              description:
                'Loads for zoom levels beyond 12. Meshblock-level incident density represented as a choropleth. Click a meshblock to view crime type distribution. The data included is of the period 2025-2026.',
              source: 'NZ Police',
              symbol: 'pie_chart',
              symbolColor: '#ef4444',
              loading: this.policeDataLoading(),
            },
          ],
          crimeData,
          meshblockInfo: meshblock
            ? {
                code: `${meshblock['meshblock_code'] ?? 'Unknown'}`,
                victimisations: Number(meshblock['victimisation_sum'] ?? 0),
                population:
                  meshblock['population_estimate'] !== null &&
                  meshblock['population_estimate'] !== undefined
                    ? Number(meshblock['population_estimate'])
                    : undefined,
                rate:
                  meshblock['victimisation_rate'] !== null &&
                  meshblock['victimisation_rate'] !== undefined
                    ? Number(meshblock['victimisation_rate'])
                    : undefined,
                populationAdjustedRate:
                  meshblock['victimisation_rate_population'] !== null &&
                  meshblock['victimisation_rate_population'] !== undefined
                    ? Number(meshblock['victimisation_rate_population'])
                    : undefined,
              }
            : undefined,
        };
      } else if (selId === 'landValue') {
        return {
          id: 'landValue',
          title: 'Market Rent',
          icon: 'real_estate_agent',
          color: '#10b981',
          sections: [
            {
              title: 'Suburb Rent Statistics',
              description:
                'Tenancy Services market rent data aggregated by suburb (Area Definition). Click a suburb on the map to view median weekly rent breakdown by dwelling type and bedrooms. Available beyond zoom level 10.',
              source: 'Tenancy Services (MBIE)',
              symbolType: 'fill-hazard',
              symbolColor: '#10b981',
              loading: this.rentDataLoading(),
            },
          ],
          rentStatistics: this.rentStatistics(),
          rentStatsLoading: this.rentStatsLoading(),
          selectedArea: this.selectedRentArea(),
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
  private searchResultMarker: maplibregl.Marker | null = null;
  private boundaryCandidateLayerIds: string[] = [];
  private resizeObserver?: ResizeObserver;

  private policeLayerController?: PoliceLayerController;
  private seismicLayerController?: SeismicLayerController;
  private floodLayerController?: FloodLayerController;
  private trafficLayerController?: TrafficLayerController;
  private rentLayerController?: RentLayerController;
  private propertySelectionController?: PropertySelectionController;
  private tooltipHandlersBound = false;

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
      this.panelInfoMode.set('layer');
      this.isDetailPanelMinimized.set(false);
    } else if (this.selectedLayerId() === id) {
      const remainingActive = this.layers().filter((l) => l.active);
      if (remainingActive.length > 0) {
        // Fall back to most recently active layer in the remaining list (or just the first one we find)
        this.selectedLayerId.set(remainingActive[remainingActive.length - 1].id);
        this.panelInfoMode.set('layer');
        this.isDetailPanelMinimized.set(false);
      } else {
        this.selectedLayerId.set(null);
        if (this.selectedPropertySummary()) {
          this.panelInfoMode.set('property');
        }
        this.isDetailPanelMinimized.set(false);
      }
    }

    if (id === 'flood') {
      this.updateFloodVisibility();
    }
    if (id === 'traffic') {
      this.updateTrafficVisibility();
    }
    if (id === 'seismic') {
      this.updateSeismicVisibility();
    }
    if (id === 'police') {
      this.updatePoliceVisibility();
    }
    if (id === 'landValue') {
      this.updateRentVisibility();
    }
  }

  toggleDetailPanelMinimized() {
    this.isDetailPanelMinimized.update((v) => !v);
  }

  setPanelInfoMode(mode: any) {
    this.panelInfoMode.set(mode as DetailPanelInfoMode);
  }

  onPanelClick() {
    if (window.innerWidth <= 768 && this.isMobileControlsOpen()) {
      this.isMobileControlsOpen.set(false);
    }
  }

  private isLayerActive(id: string): boolean {
    return this.layers().find((l) => l.id === id)?.active ?? false;
  }

  private hasActiveLayerSelection(): boolean {
    const selId = this.selectedLayerId();
    if (!selId) return false;
    return this.isLayerActive(selId);
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
    this.floodLayerController?.updateVisibility();
  }

  private updateTrafficVisibility() {
    this.trafficLayerController?.updateVisibility();
  }

  ngOnInit() {}

  ngAfterViewInit() {
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    this.initMap(container);
  }

  private initMap(container: HTMLElement) {

    const map = new maplibregl.Map({
      container,
      style: `${environment.apiUrl}/proxy/linz-basemaps/styles/topographic-v2.json?tileMatrix=WebMercatorQuad`,
      center: [172.5, -41.5],
      zoom: 5,
      maxBounds: NZ_BOUNDS,
    });

    this.map = map;
    this.policeLayerController = new PoliceLayerController({
      map,
      policeService: this.policeService,
      isLayerActive: () => this.isLayerActive('police'),
      bindFeatureTooltips: () => this.bindFeatureTooltips(map),
      setLoading: (isLoading) => this.policeDataLoading.set(isLoading),
      clearSelection: () => this.selectedPoliceMeshblock.set(null),
    });
    this.seismicLayerController = new SeismicLayerController({
      map,
      seismicService: this.seismicService,
      isLayerActive: () => this.isLayerActive('seismic'),
      bindFeatureTooltips: () => this.bindFeatureTooltips(map),
      addSeismicFaultLinesLayer: (active: boolean) => this.addSeismicFaultLinesLayer(map, active),
      addSeismicEventsLayer: (active: boolean) => this.addSeismicEventsLayer(map, active),
      setSeismicDataLoading: (loading: boolean) => this.seismicDataLoading.set(loading),
      setSeismicFaultLinesLoading: (loading: boolean) => this.seismicFaultLinesLoading.set(loading),
    });
    this.floodLayerController = new FloodLayerController({
      map,
      floodService: this.floodService,
      floodDataService: this.floodDataService,
      isLayerActive: () => this.isLayerActive('flood'),
      bindFeatureTooltips: () => this.bindFeatureTooltips(map),
      addRiverNetworkLayer: (active: boolean) => this.addRiverNetworkLayer(map, '', active),
      addFloodPlainsLayer: (active: boolean) => this.addFloodPlainsLayer(map, '', active),
      addHamiltonHazardLayer: (active: boolean) => this.addHamiltonHazardLayer(map, active),
      addFlowGaugesLayer: (active: boolean) => this.addFlowGaugesLayer(map, '', active),
      setFloodOverviewLoading: (loading: boolean) => this.floodOverviewLoading.set(loading),
      setFloodGaugesLoading: (loading: boolean) => this.floodGaugesLoading.set(loading),
      setFloodPlainsLoading: (loading: boolean) => this.floodPlainsLoading.set(loading),
      setFloodRiversLoading: (loading: boolean) => this.floodRiversLoading.set(loading),
    });
    this.trafficLayerController = new TrafficLayerController({
      map,
      trafficService: this.trafficService,
      isLayerActive: () => this.isLayerActive('traffic'),
      bindFeatureTooltips: () => this.bindFeatureTooltips(map),
      addTrafficVolumeLayer: (active: boolean) => this.addTrafficVolumeLayer(map, active),
      setTrafficLoading: (loading: boolean) => this.trafficDataLoading.set(loading),
      setHamiltonTrafficLoading: (loading: boolean) => this.trafficHamiltonDataLoading.set(loading),
    });
    this.rentLayerController = new RentLayerController({
      map,
      rentService: this.rentService,
      isLayerActive: () => this.isLayerActive('landValue'),
      bindFeatureTooltips: () => this.bindFeatureTooltips(map),
      setLoading: (isLoading) => this.rentDataLoading.set(isLoading),
    });
    this.propertySelectionController = new PropertySelectionController({
      map,
      propertyService: this.propertyService,
      propertyBoundarySourceId: MapExplorerComponent.PROPERTY_BOUNDARY_SOURCE_ID,
      getBoundaryCandidateLayerIds: () => this.boundaryCandidateLayerIds,
      setSelectedPropertyCoords: (coords) => this.selectedPropertyCoords.set(coords),
      setPanelInfoModeToProperty: () => this.panelInfoMode.set('property'),
      setPropertyLoading: (isLoading) => this.propertyLoading.set(isLoading),
      setPropertyLoadError: (error) => this.propertyLoadError.set(error),
      setSelectedPropertySummary: (summary) => this.selectedPropertySummary.set(summary),
      setDetailPanelMinimized: (isMinimized) => this.isDetailPanelMinimized.set(isMinimized),
    });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    // Robust resize handling for Safari and dynamic layouts
    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => {
        map.resize();
      });
    });
    this.resizeObserver.observe(container);

    // Initial resize trigger to ensure map takes full container size
    setTimeout(() => map.resize(), 0);

    this.zoomLevel.set(Number(map.getZoom().toFixed(1)));
    map.on('zoom', () => {
      this.ngZone.run(() => {
        this.zoomLevel.set(Number(map.getZoom().toFixed(1)));
        this.syncPoliceLayerZoomGate();
      });
    });

    map.on('click', () => {
      if (window.innerWidth <= 768 && this.isMobileControlsOpen()) {
        this.ngZone.run(() => {
          this.isMobileControlsOpen.set(false);
        });
      }
    });

    map.on('load', () => {
      this.initBasemapLayers(map);
      this.initPropertyBoundaryLayers(map);
      
      // Initial data refresh on load
      this.refreshFloodInView();
      this.refreshTrafficInView();
      this.refreshAddressesInView(map);
      this.refreshSeismicInView();
      this.refreshPoliceInView();
      this.refreshRentInView();

      map.on('moveend', () => {
        this.refreshFloodInView();
        this.refreshTrafficInView();
        this.refreshAddressesInView(map);
        this.refreshSeismicInView();
        this.refreshPoliceInView();
        this.refreshRentInView();
      });
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    if (this.map) {
      this.map.remove();
    }
  }

  private initBasemapLayers(map: maplibregl.Map) {
    const style = map.getStyle();

    map.addSource('nz-aerial', {
      type: 'raster',
      tiles: [
        `${environment.apiUrl}/proxy/linz-basemaps/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp`,
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
      const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
      const sl = (sourceLayer || '').toLowerCase();

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
    this.propertySelectionController?.highlightBoundaryAt(lat, lng);
  }

  private refreshAddressesInView(map: maplibregl.Map) {
    if (map.getZoom() < 15) return;
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const url = `https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Addresses/FeatureServer/0/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson&outSR=4326&resultRecordCount=1000`;

    const source = map.getSource('nz-addresses-arcgis') as maplibregl.GeoJSONSource;
    source?.setData(url);
  }

  private refreshFloodInView() {
    this.floodLayerController?.refreshInView();
  }

  private refreshTrafficInView() {
    this.trafficLayerController?.refreshInView();
  }

  private updateSeismicVisibility() {
    this.seismicLayerController?.updateVisibility();
  }

  private updatePoliceVisibility() {
    this.policeLayerController?.updateVisibility(POLICE_MIN_ZOOM);
  }

  private syncPoliceLayerZoomGate() {
    this.policeLayerController?.syncZoomGate(POLICE_MIN_ZOOM);
  }

  private refreshPoliceInView() {
    this.policeLayerController?.refreshInView(POLICE_MIN_ZOOM);
  }

  private updateRentVisibility() {
    this.rentLayerController?.updateVisibility();
  }

  private refreshRentInView() {
    this.rentLayerController?.refreshInView();
  }

  private refreshSeismicInView() {
    this.seismicLayerController?.refreshInView();
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

  private addTrafficVolumeLayer(map: maplibregl.Map, active: boolean) {
    const trafficValueExpression = [
      'to-number',
      [
        'coalesce',
        ['get', 'Year2023'],
        ['get', 'Year2022'],
        ['get', 'Year2021'],
        ['get', 'Year2020'],
        ['get', 'Year2019'],
        ['get', 'Year2018'],
        ['get', 'AADT'],
        ['get', 'ADT'],
        ['get', 'Average_AADT'],
        ['get', 'aadt'],
        ['get', 'adt'],
        ['get', 'Aadt'],
      ],
      -1,
    ];

    const trafficColorExpression = [
      'step',
      trafficValueExpression,
      '#94a3b8',
      0,
      '#22c55e',
      5000,
      '#84cc16',
      10000,
      '#facc15',
      20000,
      '#f97316',
      35000,
      '#ef4444',
    ];

    map.addLayer({
      id: 'traffic-volume-layer',
      type: 'line',
      source: 'traffic-volume',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        visibility: active ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': trafficColorExpression as any,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2.4, 14, 4],
        'line-opacity': 0.9,
      },
    });

    map.addLayer({
      id: 'traffic-volume-points-layer',
      type: 'circle',
      source: 'traffic-volume',
      filter: [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['==', ['get', '__traffic_source'], 'hamilton_points'],
      ],
      layout: {
        visibility: active ? 'visible' : 'none',
      },
      paint: {
        'circle-color': trafficColorExpression as any,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 12, 6, 16, 9],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
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
        'circle-color': '#fb923c',
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
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

  private bindFeatureTooltips(map: maplibregl.Map) {
    if (this.tooltipHandlersBound) return;

    const interactiveLayers: InteractiveLayerId[] = [
      'traffic-volume-layer',
      'traffic-volume-points-layer',
      'flood-plains-layer',
      'flood-rivers-major-layer',
      'flood-rivers-minor-layer',
      'flood-gauges-layer',
      'hamilton-hazard-layer',
      'seismic-events-layer',
      'seismic-fault-lines-layer',
      'police-incidents-choropleth',
      'rent-suburbs-fill',
    ] as const;

    // Note: The rent-suburbs-fill layer will get pointer cursor via the general interactiveLayers loop below

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'hover-tooltip-popup'
    });

    map.on('mousemove', 'rent-suburbs-fill', (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = (feature.properties || {}) as Record<string, unknown>;
      const suburbName = props['name'] || props['locality'] || props['suburb'] || props['NAME'] || props['Locality'];
      const html = suburbName 
        ? `<b>${suburbName}</b><br/><span style="color: #64748b; font-size: 0.85em;">Click for rent statistics</span>`
        : `<span style="color: #64748b; font-size: 0.85em;">Click for rent statistics</span>`;
      
      hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    map.on('mouseleave', 'rent-suburbs-fill', () => {
      hoverPopup.remove();
    });

    const showPopup = (e: maplibregl.MapLayerMouseEvent, layerId: InteractiveLayerId) => {
      hoverPopup.remove(); // Hide hover popup when a click popup opens
      const feature = e.features?.[0];
      if (!feature) return;

      const props = (feature.properties || {}) as Record<string, unknown>;
      const lines = getTooltipLines(layerId, props);

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

        if (layerId === 'rent-suburbs-fill') {
          const name =
            props['name'] ||
            props['locality'] ||
            props['suburb'] ||
            props['NAME'] ||
            props['Locality'];
          const majorName =
            props['major_name'] || props['territorial_authority'] || props['Major_Name'];
          const suburbName =
            majorName && name ? `${majorName} - ${name}` : name || majorName || 'Unknown';

          this.ngZone.run(() => {
            this.selectedLayerId.set('landValue');
            this.panelInfoMode.set('layer');
            this.isDetailPanelMinimized.set(false);
            this.selectedRentArea.set(String(suburbName));
            this.fetchRentStats(String(suburbName));

            // Highlight the selected polygon by changing the paint property
            // We'll use a match expression that matches either 'name', 'locality', or 'suburb' to the original property value
            // Since suburbName is a computed string, we'll match against the raw name property
            const rawName = props['name'] || props['locality'] || props['suburb'] || props['NAME'] || props['Locality'];
            if (rawName) {
              map.setPaintProperty('rent-suburbs-fill', 'fill-color', [
                'case',
                ['any',
                  ['==', ['get', 'name'], rawName],
                  ['==', ['get', 'locality'], rawName],
                  ['==', ['get', 'suburb'], rawName],
                  ['==', ['get', 'NAME'], rawName],
                  ['==', ['get', 'Locality'], rawName]
                ],
                '#f59e0b', // Selected color (amber 500)
                '#10b981'  // Default color (emerald 500)
              ]);
            }
          });
        }

        if (layerId === 'police-incidents-choropleth') {
          this.ngZone.run(() => {
            this.selectedLayerId.set('police');
            this.panelInfoMode.set('layer');
            this.isDetailPanelMinimized.set(false);
            this.selectedPoliceMeshblock.set(props);
          });
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

  private rentStatsSubscription?: Subscription;

  private fetchRentStats(suburbName: string) {
    this.rentStatsLoading.set(true);
    this.rentStatistics.set(null);

    if (this.rentStatsSubscription) {
      this.rentStatsSubscription.unsubscribe();
    }

    this.rentStatsSubscription = this.rentService.getAreaDefinitions().pipe(
      switchMap((areas) => {
        let area = areas.find((a) => a.name.toLowerCase() === suburbName.toLowerCase());

        if (!area) {
          area = areas.find(
            (a) =>
              a.name.toLowerCase().includes(suburbName.toLowerCase()) ||
              suburbName.toLowerCase().includes(a.name.toLowerCase()),
          );
        }

        if (!area && suburbName.includes(' - ')) {
          const parts = suburbName.split(' - ');
          const justSuburb = parts[parts.length - 1].trim();
          area = areas.find(
            (a) =>
              a.name.toLowerCase().includes(justSuburb.toLowerCase()) ||
              justSuburb.toLowerCase().includes(a.name.toLowerCase()),
          );
        }

        if (!area && suburbName.includes(' - ')) {
          const parts = suburbName.split(' - ');
          const city = parts[0].trim();
          const fallbackName = `${city} - all other suburbs`.toLowerCase();
          area = areas.find((a) => a.name.toLowerCase() === fallbackName);
        }

        if (area) {
          return this.rentService.getRentStatistics(area['area-definition']);
        } else {
          console.warn('Rent statistics: no matching area found for', suburbName);
          return of(null);
        }
      }),
      catchError((err) => {
        console.error('Rent statistics error:', err);
        return of(null);
      }),
      finalize(() => {
        this.rentStatsLoading.set(false);
      })
    ).subscribe({
      next: (stats) => {
        if (stats) {
          this.rentStatistics.set(stats);
        }
      }
    });
  }

  private toggleMapInteractions(enabled: boolean) {
    if (!this.map) return;

    const map = this.map;
    if (enabled) {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.dragRotate.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    } else {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    }
  }
}
