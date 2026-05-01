import { Injectable, inject, signal, computed } from '@angular/core';
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

export interface ReportHistoryItem {
  id: string;
  address: string;
  lat: number;
  lng: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  user_type: string;
  result: PropertyReport | null;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/reports/`;

  currentReport = signal<PropertyReport | null>(null);
  reports = signal<ReportHistoryItem[]>([]);
  isLoading = signal<boolean>(false);
  isFetching = signal<boolean>(false);
  hasError = signal<boolean>(false);
  isSelectorOpen = signal<boolean>(false);
  isReportsPanelOpen = signal<boolean>(false);

  isAnyReportProcessing = computed(() => 
    this.isLoading() || this.reports().some(r => r.status === 'PENDING' || r.status === 'PROCESSING')
  );

  generateReport(lat: number, lng: number, address: string, userType: 'buyer' | 'renter' = 'buyer', floodData?: Record<string, unknown> | null): Observable<any> {
    this.isLoading.set(true);
    this.hasError.set(false);
    
    // Open panel immediately to show intent
    this.isReportsPanelOpen.set(true);

    return this.http.post<any>(`${this.apiUrl}generate`, { 
      lat, 
      lng, 
      address,
      user_type: userType,
      ...(floodData ? { flood_data: floodData } : {}),
    }).pipe(
      tap(resp => {
        this.isLoading.set(false);
        this.fetchReports(); // Refresh history to show the new PENDING report
      }),
      catchError(error => {
        console.error('Error generating report:', error);
        this.isLoading.set(false);
        this.hasError.set(true);
        return of(null);
      })
    );
  }

  fetchReports() {
    this.isFetching.set(true);
    this.http.get<ReportHistoryItem[]>(this.apiUrl).subscribe({
      next: (data) => {
        this.reports.set(data);
        this.isFetching.set(false);
      },
      error: (err) => {
        console.error('Error fetching reports:', err);
        this.isFetching.set(false);
      }
    });
  }

  pollReports() {
    // Poll if there are any pending/processing reports
    const hasPending = this.reports().some(r => r.status === 'PENDING' || r.status === 'PROCESSING');
    if (hasPending) {
      this.fetchReports();
    }
  }

  openReport(report: ReportHistoryItem) {
    if (report.status === 'COMPLETED' && report.result) {
      this.currentReport.set(report.result);
      this.isReportsPanelOpen.set(false);
    }
  }

  deleteReport(reportId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}${reportId}`).pipe(
      tap(() => {
        // Remove from local signal immediately for responsive feel
        this.reports.update(items => items.filter(r => r.id !== reportId));
      }),
      catchError(error => {
        console.error('Error deleting report:', error);
        return of(null);
      })
    );
  }

  clearReport() {
    this.currentReport.set(null);
    this.hasError.set(false);
  }
}
