import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportService, ReportHistoryItem } from '../../../services/report.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-reports-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports-panel.component.html',
  styleUrl: './reports-panel.component.scss'
})
export class ReportsPanelComponent implements OnInit, OnDestroy {
  public reportService = inject(ReportService);
  protected authService = inject(AuthService);
  
  private pollInterval: any;

  ngOnInit() {
    this.reportService.fetchReports();
    this.startPolling();
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      if (this.reportService.isReportsPanelOpen()) {
        this.reportService.pollReports();
      }
    }, 5000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  onClose() {
    this.reportService.isReportsPanelOpen.set(false);
  }

  onOpenReport(report: ReportHistoryItem) {
    if (report.status === 'COMPLETED') {
      this.reportService.openReport(report);
    }
  }

  onDeleteReport(event: Event, report: ReportHistoryItem) {
    event.stopPropagation();
    if (confirm(`Are you sure you want to delete the report for ${report.address}?`)) {
      this.reportService.deleteReport(report.id).subscribe();
    }
  }

  formatDate(isoString: string): string {
    if (!isoString) return '';
    try {
      return new Intl.DateTimeFormat('en-NZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Pacific/Auckland',
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  }

  getStatusClass(status: string): string {
    return `status-${status.toLowerCase()}`;
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'PENDING': return 'schedule';
      case 'PROCESSING': return 'sync';
      case 'COMPLETED': return 'check_circle';
      case 'FAILED': return 'error';
      default: return 'help';
    }
  }
}
