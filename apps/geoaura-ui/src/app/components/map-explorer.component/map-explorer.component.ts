import { Component, OnInit, ElementRef, viewChild } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  template: `<div #mapContainer class="map-container"></div>`,
  styles: [
    `
      .map-container {
        width: 100%;
        height: 100vh;
      }
    `,
  ],
})
export class MapExplorerComponent implements OnInit {
  private mapContainer = viewChild<ElementRef>('mapContainer');

  ngOnInit() {
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: `https://basemaps.linz.govt.nz/v1/styles/topographic-v2.json?api=${environment.linzApiKey}&tileMatrix=WebMercatorQuad`,
      center: [174.7633, -36.8485],
      zoom: 16,
    });

    map.addControl(new maplibregl.NavigationControl());
  }
}
