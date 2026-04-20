import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AreaDefinition {
  'area-definition': string;
  name: string;
  id?: string;
}

export interface RentStatistics {
  'area-definition'?: string;
  'period-ending'?: string;
  'num-months'?: number;
  'statistics'?: RentStatisticItem[];
}

export interface RentStatisticItem {
  'dwelling-type'?: string;
  'num-bedrooms'?: string;
  'lower-quartile-rent'?: number;
  'median-rent'?: number;
  'upper-quartile-rent'?: number;
  'count'?: number;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root',
})
export class RentService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/rent';

  getAreaDefinitions(): Observable<AreaDefinition[]> {
    return this.http.get<AreaDefinition[]>(`${this.baseUrl}/area-definitions`);
  }

  getRentStatistics(
    areaDefinition: string,
    periodEnding?: string,
    numMonths: number = 6
  ): Observable<RentStatistics> {
    const params: any = { 'area_definition': areaDefinition, 'num_months': numMonths.toString() };
    if (periodEnding) {
      params['period_ending'] = periodEnding;
    }
    return this.http.get<RentStatistics>(`${this.baseUrl}/statistics`, { params });
  }

  getAreaDefinition(areaId: string): Observable<AreaDefinition> {
    return this.http.get<AreaDefinition>(`${this.baseUrl}/area-definitions/${areaId}`);
  }

  getRentAreasForExtent(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    limit: number = 500
  ): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/extent`, {
      params: {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
        limit: limit.toString(),
      },
    });
  }
}
