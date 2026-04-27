import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, catchError, of, tap } from 'rxjs';

export interface ReportKeyFact {
  text?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  icon: string;
  risk_level: 'low' | 'medium' | 'high' | 'unknown';
  content: string;
  key_facts: string[];
}

export interface PropertyReport {
  title: string;
  generated_at: string;
  address: string;
  coordinates: { lat: number; lng: number };
  executive_summary: string;
  sections: ReportSection[];
  overall_risk_rating: 'low' | 'medium' | 'high' | 'unknown';
  recommendation: string;
  disclaimer: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/reports`;

  currentReport = signal<PropertyReport | null>(null);
  isLoading = signal<boolean>(false);
  hasError = signal<boolean>(false);
  isSelectorOpen = signal<boolean>(false);

  generateReport(lat: number, lng: number, address: string, userType: 'buyer' | 'renter' = 'buyer'): Observable<PropertyReport | null> {
    this.isLoading.set(true);
    this.hasError.set(false);

    return this.http.post<PropertyReport>(`${this.apiUrl}/generate`, { 
      lat, 
      lng, 
      address,
      user_type: userType 
    }).pipe(
      tap(report => {
        this.currentReport.set(report);
        this.isLoading.set(false);
      }),
      catchError(error => {
        console.error('Error generating report:', error);
        this.isLoading.set(false);
        this.hasError.set(true);
        return of(null);
      })
    );
  }

  clearReport() {
    this.currentReport.set(null);
    this.hasError.set(false);
  }
}
