import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

export interface AddressSuggestion {
  id: string;
  label: string;
  lat: number;
  lng: number;
  territorial_authority?: string | null;
}

export interface ParcelGeometryFeature {
  type: 'Feature';
  geometry: GeoJSON.Geometry;
  properties: GeoJSON.GeoJsonProperties;
}

export interface PropertySummary {
  title?: {
    title_no?: string | null;
    land_district?: string | null;
    type?: string | null;
  };
  parcel?: {
    appellation?: string | null;
    area?: string | number | null;
    purpose?: string | null;
  };
  address?: {
    full_address?: string | null;
    territorial_authority?: string | null;
  };
  location?: {
    council?: string | null;
    ta_id?: string | number | null;
  };
  building?: {
    use?: string | null;
    age?: string | number | null;
    risk_class?: string | null;
  };
  bridge?: {
    building_id?: string | number | null;
    property_id?: string | number | null;
  };
}

@Injectable({
  providedIn: 'root',
})
export class PropertyService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/properties';

  searchAddresses(query: string, limit: number = 5): Observable<AddressSuggestion[]> {
    return this.http.get<AddressSuggestion[]>(`${this.baseUrl}/address-search`, {
      params: { q: query, limit: limit.toString() },
    });
  }

  getParcelGeometry(lat: number, lng: number): Observable<ParcelGeometryFeature | null> {
    return this.http.get<ParcelGeometryFeature | null>(`${this.baseUrl}/parcel-geometry`, {
      params: { lat: lat.toString(), lng: lng.toString() },
    });
  }

  getPropertySummary(lat: number, lng: number): Observable<PropertySummary> {
    return this.http.get<PropertySummary>(`${this.baseUrl}/summary`, {
      params: { lat: lat.toString(), lng: lng.toString() },
    });
  }

  getCouncilInfo(lat: number, lng: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/council`, {
      params: { lat: lat.toString(), lng: lng.toString() },
    });
  }
}
