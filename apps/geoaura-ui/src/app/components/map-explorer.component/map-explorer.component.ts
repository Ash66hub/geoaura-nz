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

  private map?: maplibregl.Map;
  private floodLayersAdded = false;

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
      this.initNationalLayers(this.map);
      this.floodLayersAdded = true;
      // Also check if we should load regional immediately
      this.checkRegionalFlood(this.map);
      return;
    }

    const visibility = active ? 'visible' : 'none';
    const layers = ['flood-rivers-layer', 'flood-gauges-layer', 'flood-plains-layer', 'flood-regional-fill', 'flood-regional-raster'];
    
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
      this.initRegionalWatch(map);
      // We don't call initNationalLayers here anymore, updateFloodVisibility handles it
    });
  }

  private initNationalLayers(map: maplibregl.Map) {
    this.floodService.getNationalLayerInfo().subscribe({
      next: (info: any) => {
        try {
          console.log('[Flood-API-Response]', info);
          const currentActive = this.layers().find(l => l.id === 'flood')?.active ?? false;
          const layers = info.layers;

          if (layers?.flood_plains?.geojson_url) {
            this.addFloodPlainsLayer(map, layers.flood_plains.geojson_url, currentActive);
          }

          if (layers?.river_network?.geojson_url) {
            this.addRiverNetworkLayer(map, layers.river_network.geojson_url, currentActive);
          }

          if (layers?.flow_gauges?.geojson_url) {
            this.addFlowGaugesLayer(map, layers.flow_gauges.geojson_url, currentActive);
          }
          
          this.updateFloodVisibility();
        } catch (e) {
          console.error('[initNationalLayers-Error]', e);
        }
      },
      error: (err) => console.error('Could not fetch national flood layer info:', err)
    });
  }

  private initRegionalWatch(map: maplibregl.Map) {
    map.on('moveend', () => this.checkRegionalFlood(map));
  }

  private checkRegionalFlood(map: maplibregl.Map) {
    if (!this.isLayerActive('flood')) return;

    const zoom = map.getZoom();
    if (zoom < 8) return;

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
          map.addSource('flood-regional', {
            type: 'raster',
            tiles: [info.url],
            tileSize: 256
          });
          map.addLayer({
            id: 'flood-regional-raster',
            type: 'raster',
            source: 'flood-regional',
            layout: {
              'visibility': this.isLayerActive('flood') ? 'visible' : 'none'
            },
            paint: { 'raster-opacity': 0.6 }
          }, beforeId);
        } else {
          map.addSource('flood-regional', {
            type: 'geojson',
            data: info.geojson_url
          });
          map.addLayer({
            id: 'flood-regional-fill',
            type: 'fill',
            source: 'flood-regional',
            layout: {
              'visibility': this.isLayerActive('flood') ? 'visible' : 'none'
            },
            paint: {
              'fill-color': '#03a9f4',
              'fill-opacity': 0.5,
              'fill-outline-color': '#01579b'
            }
          }, beforeId);
        }
      },
      error: (err) => console.warn(`No regional flood data for ${councilName}:`, err)
    });
  }

  private addFloodPlainsLayer(map: maplibregl.Map, geojsonUrl: string, active: boolean) {
    if (map.getSource('flood-plains')) return;

    map.addSource('flood-plains', {
      type: 'geojson',
      data: geojsonUrl,
    });

    map.addLayer({
      id: 'flood-plains-layer',
      type: 'fill',
      source: 'flood-plains',
      layout: {
        'visibility': active ? 'visible' : 'none'
      },
      paint: {
        'fill-color': '#60a5fa',
        'fill-opacity': 0.4,
        'fill-outline-color': '#2563eb'
      }
    }); 
  }

  private addRiverNetworkLayer(map: maplibregl.Map, geojsonUrl: string, active: boolean) {
    if (map.getSource('flood-rivers')) return;
    console.log('[Adding-River-Layer]', geojsonUrl);

    map.addSource('flood-rivers', {
      type: 'geojson',
      data: geojsonUrl,
    });

    map.addLayer({
      id: 'flood-rivers-layer',
      type: 'line',
      source: 'flood-rivers',
      layout: {
        'visibility': active ? 'visible' : 'none'
      },
      paint: {
        'line-color': [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'H_C18_MAF'], 0],
          0,    '#93c5fd', // Light Blue
          100,  '#3b82f6', // Bright Blue
          1000, '#1d4ed8', // Deep Blue
          5000, '#1e3a8a'  // Indigo
        ],
        'line-width': [
          'interpolate', ['exponential', 1.5], ['zoom'],
          4, ['interpolate', ['linear'], ['coalesce', ['get', 'q100_reach'], 0],
              0, 2, 500, 6, 5000, 12],
          12, ['interpolate', ['linear'], ['coalesce', ['get', 'q100_reach'], 0],
               0, 4, 1000, 15, 5000, 25]
        ],
        'line-opacity': 0.9,
      },
    });
  }

  private addFlowGaugesLayer(map: maplibregl.Map, geojsonUrl: string, active: boolean) {
    map.addSource('flood-gauges', {
      type: 'geojson',
      data: geojsonUrl,
    });

    map.addLayer({
      id: 'flood-gauges-layer',
      type: 'circle',
      source: 'flood-gauges',
      layout: {
        'visibility': active ? 'visible' : 'none'
      },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, 3,
          12, 10
        ],
        'circle-color': '#ff5722',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 1,
      },
    });
  }
}
