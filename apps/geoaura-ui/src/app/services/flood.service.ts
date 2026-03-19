import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FloodService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/flood';

  getNationalLayerInfo(): Observable<any> {
    return this.http.get(`${this.baseUrl}/national-layer`);
  }

  getRegionalLayerInfo(council: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/regional-layer`, {
      params: { council }
    });
  }

  getFloodInfoForExtent(minLng: number, minLat: number, maxLng: number, maxLat: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/extent`, {
      params: { min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat }
    });
  }
}
