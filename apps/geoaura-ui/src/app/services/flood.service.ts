import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class FloodService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/flood';

  public async getHamiltonHazardGeoJson(url: string, signal?: AbortSignal): Promise<any> {
    const proxyUrl = `${environment.apiUrl}/proxy/hamilton-hazard?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, { signal }).then((res) => res.json());
  }

  public getFloodInfoForExtent(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    limit: number = 500,
  ): Observable<any> {
    return this.http.get(`${this.baseUrl}/extent`, {
      params: { min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat, limit: limit },
    });
  }
}
