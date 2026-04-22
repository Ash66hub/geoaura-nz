import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PropertyReport, ReportSection } from '../../../services/report.service';

@Component({
  selector: 'app-report-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './report-viewer.component.html',
  styleUrl: './report-viewer.component.scss'
})
export class ReportViewerComponent {
  @Input() report: PropertyReport | null = null;
  @Output() close = new EventEmitter<void>();

  onClose() {
    this.close.emit();
  }

  onPrint() {
    window.print();
  }

  riskColor(level: string): string {
    const map: Record<string, string> = {
      low: '#22c55e',
      medium: '#f59e0b',
      high: '#ef4444',
      unknown: '#64748b',
    };
    return map[level] ?? map['unknown'];
  }

  riskLabel(level: string): string {
    const map: Record<string, string> = {
      low: 'Low Risk',
      medium: 'Medium Risk',
      high: 'High Risk',
      unknown: 'Unknown',
    };
    return map[level] ?? 'Unknown';
  }

  overallRiskClass(level: string): string {
    const map: Record<string, string> = {
      low: 'risk-low',
      medium: 'risk-medium',
      high: 'risk-high',
      unknown: 'risk-unknown',
    };
    return map[level] ?? 'risk-unknown';
  }

  sectionIcon(section: ReportSection): string {
    return section.icon ?? 'info';
  }

  formatDate(isoString: string): string {
    if (!isoString) return 'Just now';
    try {
      return new Intl.DateTimeFormat('en-NZ', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Pacific/Auckland',
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  }
}
