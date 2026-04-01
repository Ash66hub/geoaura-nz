import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TrafficExtentResponse {
  traffic_url?: string;
  traffic_lines_url?: string;
  traffic_points_url?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TrafficService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/traffic';

  getTrafficForExtent(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    limit: number = 5000,
  ): Observable<TrafficExtentResponse> {
    return this.http.get<TrafficExtentResponse>(`${this.baseUrl}/extent`, {
      params: { min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat, limit },
    });
  }
}
