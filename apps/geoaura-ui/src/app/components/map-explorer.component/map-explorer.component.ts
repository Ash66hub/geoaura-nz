import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import * as maplibregl from 'maplibre-gl';

@Component({
  selector: 'app-map-explorer',
  standalone: true,
  template: `<div #mapContainer class="map-container"></div>`,
  styles: [`
    .map-container {
      width: 100%;
      height: 100vh; /* This ensures the map fills the screen */
    }
  `]
})
export class MapExplorerComponent implements OnInit {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;

  ngOnInit() {
    const map = new maplibregl.Map({
      container: this.mapContainer.nativeElement,
      style: 'https://demotiles.maplibre.org/style.json', // Free default style
      center: [175.279, -37.787], // Hamilton, NZ Coordinates
      zoom: 12
    });

    map.addControl(new maplibregl.NavigationControl());
  }
}