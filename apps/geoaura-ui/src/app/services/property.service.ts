import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PropertyService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl + '/properties';

  getPropertySummary(lat: number, lng: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/summary`, {
      params: { lat: lat.toString(), lng: lng.toString() }
    });
  }

  getCouncilInfo(lat: number, lng: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/council`, {
      params: { lat: lat.toString(), lng: lng.toString() }
    });
  }
}
