import * as maplibregl from 'maplibre-gl';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  PropertyService,
  PropertySummary,
} from '../../../services/property.service';
import { chooseBoundaryFeature } from './property-boundary.utils';

interface PropertySelectionControllerDeps {
  map: maplibregl.Map;
  propertyService: PropertyService;
  propertyBoundarySourceId: string;
  getBoundaryCandidateLayerIds: () => string[];
  setSelectedPropertyCoords: (coords: { lat: number; lng: number } | null) => void;
  setPanelInfoModeToProperty: () => void;
  setPropertyLoading: (isLoading: boolean) => void;
  setPropertyLoadError: (error: string | null) => void;
  setSelectedPropertySummary: (summary: PropertySummary | null) => void;
  setDetailPanelMinimized: (isMinimized: boolean) => void;
}

export class PropertySelectionController {
  private readonly map: maplibregl.Map;
  private readonly propertyService: PropertyService;
  private readonly propertyBoundarySourceId: string;
  private readonly getBoundaryCandidateLayerIds: () => string[];
  private readonly setSelectedPropertyCoords: (coords: { lat: number; lng: number } | null) => void;
  private readonly setPanelInfoModeToProperty: () => void;
  private readonly setPropertyLoading: (isLoading: boolean) => void;
  private readonly setPropertyLoadError: (error: string | null) => void;
  private readonly setSelectedPropertySummary: (summary: PropertySummary | null) => void;
  private readonly setDetailPanelMinimized: (isMinimized: boolean) => void;

  private propertySummaryRequestId = 0;
  private boundaryLookupRequestId = 0;

  constructor(deps: PropertySelectionControllerDeps) {
    this.map = deps.map;
    this.propertyService = deps.propertyService;
    this.propertyBoundarySourceId = deps.propertyBoundarySourceId;
    this.getBoundaryCandidateLayerIds = deps.getBoundaryCandidateLayerIds;
    this.setSelectedPropertyCoords = deps.setSelectedPropertyCoords;
    this.setPanelInfoModeToProperty = deps.setPanelInfoModeToProperty;
    this.setPropertyLoading = deps.setPropertyLoading;
    this.setPropertyLoadError = deps.setPropertyLoadError;
    this.setSelectedPropertySummary = deps.setSelectedPropertySummary;
    this.setDetailPanelMinimized = deps.setDetailPanelMinimized;
  }

  clearSelectedPropertyContext() {
    this.setSelectedPropertyCoords(null);
    this.setSelectedPropertySummary(null);
    this.setPropertyLoading(false);
    this.setPropertyLoadError(null);
  }

  highlightBoundaryAt(lat: number, lng: number) {
    this.fetchPropertySummary(lat, lng);

    const requestId = ++this.boundaryLookupRequestId;
    this.propertyService
      .getParcelGeometry(lat, lng)
      .pipe(catchError(() => of(null)))
      .subscribe((feature) => {
        if (requestId !== this.boundaryLookupRequestId) return;

        const source = this.map.getSource(this.propertyBoundarySourceId) as maplibregl.GeoJSONSource;
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

  private fetchPropertySummary(lat: number, lng: number) {
    const requestId = ++this.propertySummaryRequestId;
    this.setSelectedPropertyCoords({ lat, lng });
    this.setPanelInfoModeToProperty();
    this.setPropertyLoading(true);
    this.setPropertyLoadError(null);
    this.setSelectedPropertySummary(null);
    this.setDetailPanelMinimized(false);

    this.propertyService
      .getPropertySummary(lat, lng)
      .pipe(catchError(() => of(null)))
      .subscribe((summary) => {
        if (requestId !== this.propertySummaryRequestId) return;

        this.setPropertyLoading(false);
        if (!summary) {
          this.setSelectedPropertySummary(null);
          this.setPropertyLoadError('No property summary data found for this location.');
          return;
        }

        this.setSelectedPropertySummary(summary);
        this.setPropertyLoadError(null);
      });
  }

  private highlightBoundaryFromRenderedLayers(lat: number, lng: number): boolean {
    const boundaryCandidateLayerIds = this.getBoundaryCandidateLayerIds();
    if (boundaryCandidateLayerIds.length === 0) return false;

    const pixel = this.map.project([lng, lat]);
    const candidates = this.map.queryRenderedFeatures(
      [
        [pixel.x - 4, pixel.y - 4],
        [pixel.x + 4, pixel.y + 4],
      ],
      {
        layers: boundaryCandidateLayerIds,
      },
    );

    const boundary = chooseBoundaryFeature(candidates, lng, lat);

    if (!boundary || !boundary.geometry) {
      return false;
    }

    const source = this.map.getSource(this.propertyBoundarySourceId) as maplibregl.GeoJSONSource;
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
}