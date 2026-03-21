import { Component, OnInit, ElementRef, viewChild, inject, signal } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { LngLatBoundsLike } from 'maplibre-gl';
import { environment } from '../../../environments/environment';
import { FloodService } from '../../services/flood.service';
import { PropertyService } from '../../services/property.service';
import { CommonModule } from '@angular/common';

const NZ_BOUNDS: LngLatBoundsLike = [[165.0, -48.5], [179.5, -33.0]];

interface LayerItem {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  colorClass: string;
  iconColorClass: string;
}

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-explorer.component.html',
  styleUrl: './map-explorer.component.scss'
})
export class MapExplorerComponent implements OnInit {
  private mapContainer = viewChild<ElementRef>('mapContainer');
  private floodService = inject(FloodService);
  private propertyService = inject(PropertyService);
  private currentCouncil: string | null = null;

  layers = signal<LayerItem[]>([
    { id: 'traffic', name: 'Traffic Volume', icon: 'traffic', active: false, colorClass: 'primary', iconColorClass: 'text-primary' },
    { id: 'flood', name: 'Flood History', icon: 'water_damage', active: false, colorClass: 'primary', iconColorClass: 'text-blue-400' },
    { id: 'seismic', name: 'Seismic Events', icon: 'waves', active: false, colorClass: 'orange', iconColorClass: 'text-accent-orange' },
    { id: 'liquefaction', name: 'Liquefaction', icon: 'grid_view', active: false, colorClass: 'primary', iconColorClass: 'text-slate-500' },
    { id: 'police', name: 'Police Incidents', icon: 'local_police', active: false, colorClass: 'primary', iconColorClass: 'text-slate-500' }
  ]);

  currentMapMode = signal<'satellite' | 'topo'>('satellite');
  private topoLayers: string[] = [];
  private map?: maplibregl.Map;
  private floodLayersAdded = false;

  toggleMapMode(mode: 'satellite' | 'topo') {
    this.currentMapMode.set(mode);
    if (!this.map) return;

    const isSatellite = mode === 'satellite';
    const visibility = isSatellite ? 'visible' : 'none';
    const topoVisibility = isSatellite ? 'none' : 'visible';

    if (this.map.getLayer('nz-aerial-layer')) {
      this.map.setLayoutProperty('nz-aerial-layer', 'visibility', visibility);
    }

    this.topoLayers.forEach(layerId => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', topoVisibility);
      }
    });
  }

  toggleLayer(id: string) {
    this.layers.update(currentLayers => 
      currentLayers.map(layer => 
        layer.id === id ? { ...layer, active: !layer.active } : layer
      )
    );

    if (id === 'flood') {
      this.updateFloodVisibility();
    }
  }

  private isLayerActive(id: string): boolean {
    return this.layers().find(l => l.id === id)?.active ?? false;
  }

  private updateFloodVisibility() {
    if (!this.map) return;
    const active = this.isLayerActive('flood');

    if (active && !this.floodLayersAdded) {
      this.initFloodLayers(this.map);
      this.floodLayersAdded = true;
      this.checkRegionalFlood(this.map);
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = [
      'flood-rivers-layer', 
      'flood-gauges-layer', 
      'flood-gauges-cluster',
      'flood-gauges-count',
      'flood-plains-layer', 
      'flood-regional-fill', 
      'flood-regional-raster'
    ];
    
    layers.forEach(layerId => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });
  }

  ngOnInit() {
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: `https://basemaps.linz.govt.nz/v1/styles/topographic-v2.json?api=${environment.linzApiKey}&tileMatrix=WebMercatorQuad`,
      center: [172.5, -41.5],
      zoom: 5,
      maxBounds: NZ_BOUNDS
    });

    this.map = map;
    map.addControl(new maplibregl.NavigationControl());

    map.on('load', () => {
      this.initBasemapLayers(map);
      this.initRegionalWatch(map);
    });
  }

  private initBasemapLayers(map: maplibregl.Map) {
    const style = map.getStyle();
    
    map.addSource('nz-aerial', {
      type: 'raster',
      tiles: [
        `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=${environment.linzApiKey}`
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.linz.govt.nz/">LINZ</a>'
    });

    map.addLayer({
      id: 'nz-aerial-layer',
      type: 'raster',
      source: 'nz-aerial',
      layout: { 'visibility': this.currentMapMode() === 'satellite' ? 'visible' : 'none' },
      paint: { 'raster-opacity': 1 }
    }, style.layers?.[0]?.id);

    this.topoLayers = [];
    style.layers?.forEach(layer => {
      const id = layer.id.toLowerCase();
      const sl = ((layer as any)['source-layer'] || '').toLowerCase();

      if (id.startsWith('nz-')) return;

      if (layer.type === 'fill' || layer.type === 'background') {
        this.topoLayers.push(layer.id);
        if (this.currentMapMode() === 'satellite') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      }

      if (id.includes('address') || id.includes('house') || id.includes('point') || id.includes('number') ||
          sl.includes('address') || sl.includes('house') || sl.includes('point') || sl.includes('number')) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });

    map.addSource('nz-addresses-arcgis', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'nz-addresses-layer',
      type: 'circle',
      source: 'nz-addresses-arcgis',
      minzoom: 15,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          15, 2, 18, 5
        ],
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#2196f3'
      }
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
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5
      }
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
    const visibility = active ? 'visible' : 'none';

    // 1. River Network Source & Layer
    map.addSource('flood-rivers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.addRiverNetworkLayer(map, '', active);

    // 2. Flood Plains Source & Layer
    map.addSource('flood-plains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.addFloodPlainsLayer(map, '', active);

    // 3. Flow Gauges Source (Clustered)
    map.addSource('flood-gauges', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 50
    });
    this.addFlowGaugesLayer(map, '', active);

    this.floodLayersAdded = true;
    this.refreshFloodInView(map);
  }

  private refreshFloodInView(map: maplibregl.Map) {
    if (!this.isLayerActive('flood')) return;

    const bounds = map.getBounds();
    this.floodService.getFloodInfoForExtent(
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()
    ).subscribe({
      next: (info: any) => {
        if (info.rivers_url) {
          const source = map.getSource('flood-rivers') as maplibregl.GeoJSONSource;
          source?.setData(info.rivers_url);
        }
        if (info.gauges_url) {
          const source = map.getSource('flood-gauges') as maplibregl.GeoJSONSource;
          source?.setData(info.gauges_url);
        }
      }
    });
  }

  private initRegionalWatch(map: maplibregl.Map) {
    map.on('moveend', () => {
      this.checkRegionalFlood(map);
      this.refreshFloodInView(map);
      this.refreshAddressesInView(map);
    });
  }

  private checkRegionalFlood(map: maplibregl.Map) {
    if (!this.isLayerActive('flood')) return;
    if (map.getZoom() < 8) return;

    const center = map.getCenter();
    this.propertyService.getCouncilInfo(center.lat, center.lng).subscribe({
      next: (councilData) => {
        const councilName = councilData.name || councilData.council;
        if (councilName && councilName !== this.currentCouncil) {
          this.currentCouncil = councilName;
          this.loadRegionalFloodPlains(map, councilName);
        }
      }
    });
  }

  private loadRegionalFloodPlains(map: maplibregl.Map, councilName: string) {
    this.floodService.getRegionalLayerInfo(councilName).subscribe({
      next: (info) => {
        if (!info || !info.url) return;
        if (map.getLayer('flood-regional-fill')) map.removeLayer('flood-regional-fill');
        if (map.getLayer('flood-regional-raster')) map.removeLayer('flood-regional-raster');
        if (map.getSource('flood-regional')) map.removeSource('flood-regional');

        const beforeId = map.getLayer('flood-rivers-layer') ? 'flood-rivers-layer' : undefined;

        if (info.type === 'raster') {
          map.addSource('flood-regional', { type: 'raster', tiles: [info.url], tileSize: 256 });
          map.addLayer({
            id: 'flood-regional-raster',
            type: 'raster',
            source: 'flood-regional',
            layout: { 'visibility': 'visible' },
            paint: { 'raster-opacity': 0.7 }
          }, beforeId);
        } else {
          map.addSource('flood-regional', { type: 'geojson', data: info.geojson_url });
          
          map.addLayer({
            id: 'flood-regional-fill',
            type: 'fill',
            source: 'flood-regional',
            layout: { 'visibility': 'visible' },
            paint: {
              'fill-color': '#2962ff',
              'fill-opacity': 0.35
            }
          }, beforeId);

          map.addLayer({
            id: 'flood-regional-outline',
            type: 'line',
            source: 'flood-regional',
            layout: { 'visibility': 'visible' },
            paint: {
              'line-color': '#0d47a1',
              'line-width': 1.5,
              'line-opacity': 0.8
            }
          }, 'flood-regional-fill');
        }
      }
    });
  }

  private addFloodPlainsLayer(map: maplibregl.Map, url: string, active: boolean) {
    map.addLayer({
      id: 'flood-plains-layer',
      type: 'fill',
      source: 'flood-plains',
      layout: { 'visibility': active ? 'visible' : 'none' },
      paint: {
        'fill-color': '#60a5fa',
        'fill-opacity': 0.4,
        'fill-outline-color': '#2563eb'
      }
    }); 
  }

  private addRiverNetworkLayer(map: maplibregl.Map, url: string, active: boolean) {
    map.addLayer({
      id: 'flood-rivers-layer',
      type: 'line',
      source: 'flood-rivers',
      layout: { 'visibility': active ? 'visible' : 'none' },
      paint: {
        'line-color': [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'H_C18_MAF'], 0],
          0, '#93c5fd', 100, '#3b82f6', 1000, '#1d4ed8', 5000, '#1e3a8a'
        ],
        'line-width': [
          'interpolate', ['exponential', 1.5], ['zoom'],
          4, ['interpolate', ['linear'], ['coalesce', ['get', 'q100_reach'], 0], 0, 2, 500, 6, 5000, 12],
          12, ['interpolate', ['linear'], ['coalesce', ['get', 'q100_reach'], 0], 0, 4, 1000, 15, 5000, 25]
        ],
        'line-opacity': 0.9,
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
      layout: { 'visibility': visibility },
      paint: {
        'circle-color': '#ff9800',
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Cluster Counts
    map.addLayer({
      id: 'flood-gauges-count',
      type: 'symbol',
      source: 'flood-gauges',
      filter: ['has', 'point_count'],
      layout: {
        'visibility': visibility,
        'text-field': '{point_count}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
      }
    });

    // Individual Points
    map.addLayer({
      id: 'flood-gauges-layer',
      type: 'circle',
      source: 'flood-gauges',
      filter: ['!', ['has', 'point_count']],
      layout: { 'visibility': visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 12],
        'circle-color': '#ff5722',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
      },
    });
  }
}
