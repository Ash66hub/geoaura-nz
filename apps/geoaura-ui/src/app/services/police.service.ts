import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CrimeBreakdown {
  [crimeType: string]: number;
}

export interface PoliceFeature {
  type: 'Feature';
  properties: {
    meshblock_code: string;
    victimisation_sum: number;
    victimisation_rate: number | null;
    crime_breakdown: CrimeBreakdown;
    population_estimate: number | null;
  };
  geometry: GeoJSON.Geometry | null;
  id: string;
}

export interface PoliceIncidentsResponse {
  type: 'FeatureCollection';
  features: PoliceFeature[];
  properties: {
    data_source: string;
    time_period: string;
    aggregation_level: string;
    aggregate_type: string;
  };
}

@Injectable({
  providedIn: 'root',
})
export class PoliceService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/police';

  getPoliceIncidents(): Observable<PoliceIncidentsResponse> {
    return this.http.get<PoliceIncidentsResponse>(`${this.baseUrl}/incidents`);
  }

  getPoliceIncidentsForExtent(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    limit: number = 2000,
  ): Observable<PoliceIncidentsResponse> {
    return this.http.get<PoliceIncidentsResponse>(`${this.baseUrl}/extent`, {
      params: {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
        limit,
      },
    });
  }
}
