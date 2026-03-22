import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SeismicService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/seismic';

  getSeismicInfoForExtent(
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
