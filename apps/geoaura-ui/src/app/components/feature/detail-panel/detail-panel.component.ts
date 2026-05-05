import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrimePieChartComponent } from '../../shared/crime-pie-chart/crime-pie-chart.component';
import { RentStatistics } from '../../../services/rent.service';
import { ReportService } from '../../../services/report.service';
import { ReportSelectorComponent } from '../report-selector/report-selector.component';
import { AuthService } from '../../../services/auth.service';
import { FloodDataService } from '../../../services/flood-data.service';

export type DetailPanelInfoMode = 'layer' | 'property';

export interface DetailPanelLegendItem {
  label: string;
  symbolType: NonNullable<DetailPanelSection['symbolType']>;
}

export interface DetailPanelSection {
  title: string;
  description: string;
  links?: Array<{
    label: string;
    href: string;
  }>;
  source?: string;
  symbol?: string;
  symbolColor?: string;
  loading?: boolean;
  legendItems?: DetailPanelLegendItem[];
  symbolType?:
    | 'fill-hazard'
    | 'fill-flood'
    | 'point-gauge'
    | 'line-river'
    | 'point-seismic'
    | 'line-fault'
    | 'line-traffic-bin-1'
    | 'line-traffic-bin-2'
    | 'line-traffic-bin-3'
    | 'line-traffic-bin-4'
    | 'line-traffic-bin-5'
    | 'point-traffic-hamilton';
}

export interface DetailPanelModel {
  id: string;
  title: string;
  icon: string;
  color: string;
  sections: DetailPanelSection[];
  placeholder?: boolean;
  crimeData?: Array<{ label: string; value: number }>;
  meshblockInfo?: {
    code: string;
    victimisations: number;
    population?: number;
    rate?: number;
    populationAdjustedRate?: number;
  };
  rentStatistics?: RentStatistics | null;
  rentStatsLoading?: boolean;
  selectedArea?: string | null;
  coords?: { lat: number; lng: number } | null;
  propertyLoading?: boolean;
}

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [CommonModule, CrimePieChartComponent, ReportSelectorComponent],
  templateUrl: './detail-panel.component.html',
  styleUrl: './detail-panel.component.scss',
})
export class DetailPanelComponent {
  @Input() model: DetailPanelModel | null = null;
  @Input() minimized = false;
  @Input() showInfoModeToggle = false;
  @Input() infoMode: DetailPanelInfoMode = 'property';
  @Output() toggleMinimize = new EventEmitter<void>();
  @Output() infoModeChange = new EventEmitter<DetailPanelInfoMode>();
  public reportService = inject(ReportService);
  public authService = inject(AuthService);
  private floodDataService = inject(FloodDataService);
  
  showRateInfo = false;
  showPopulationAdjustedRateInfo = false;

  private readonly sourceLinks: Record<string, string> = {
    geonet: 'https://www.geonet.org.nz/',
    'gns science': 'https://www.gns.cri.nz/',
    niwa: 'https://niwa.co.nz/',
    linz: 'https://www.linz.govt.nz/',
    'nz police':
      'https://www.police.govt.nz/about-us/publications-statistics/data-and-statistics/policedatanz/',
    'waikato regional council': 'https://www.waikatoregion.govt.nz/',
    'hamilton city council': 'https://hamilton.govt.nz/',
    nzta: 'https://www.nzta.govt.nz/',
    'waka kotahi': 'https://www.nzta.govt.nz/',
    'tenancy services (mbie)': 'https://www.tenancy.govt.nz/rent-bond-and-bills/market-rent/',
  };

  private _rentSearchDate: Date | null = null;
  private _lastStatsRef: any = null;

  get rentSearchDate(): Date | null {
    if (this.model?.rentStatistics !== this._lastStatsRef) {
      this._lastStatsRef = this.model?.rentStatistics;
      if (this.model?.rentStatistics) {
        this._rentSearchDate = new Date();
      }
    }
    return this._rentSearchDate;
  }

  onToggleMinimize() {
    this.toggleMinimize.emit();
  }

  onInfoModeChange(mode: DetailPanelInfoMode) {
    if (mode === this.infoMode) return;
    this.infoModeChange.emit(mode);
  }

  toggleRateInfo() {
    this.showRateInfo = !this.showRateInfo;
  }

  togglePopulationAdjustedRateInfo() {
    this.showPopulationAdjustedRateInfo = !this.showPopulationAdjustedRateInfo;
  }

  getRateDescription(): string {
    return 'Incident density: total victimisations in this meshblock divided by land area in square kilometres.';
  }

  getPopulationAdjustedRateDescription(): string {
    return 'Incidents per 1,000 residents.';
  }

  getSourceHref(source?: string): string | null {
    if (!source) return null;
    const normalized = source.toLowerCase();

    for (const key of Object.keys(this.sourceLinks)) {
      if (normalized.includes(key)) {
        return this.sourceLinks[key];
      }
    }

    return null;
  }

  getSectionSources(): string[] {
    if (!this.model) return [];

    const orderedSources: string[] = [];
    const seen = new Set<string>();

    for (const section of this.model.sections) {
      const source = section.source?.trim();
      if (!source) continue;

      const key = source.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      orderedSources.push(source);
    }

    return orderedSources;
  }

  getPropertyGoogleMapsLink(): string | null {
    if (!this.model || this.model.id !== 'property') {
      return null;
    }

    const addressSection = this.model.sections.find((section) => section.title === 'Address');
    const rawDescription = addressSection?.description?.trim();
    if (!rawDescription) {
      return null;
    }

    const primaryAddress = rawDescription
      .split('Territorial Authority:')[0]
      .replace(/\.+$/, '')
      .trim();

    if (!primaryAddress || primaryAddress.toLowerCase() === 'unknown') {
      return null;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(primaryAddress)}`;
  }

  onGenerateReport() {
    if (this.model?.propertyLoading) return;
    this.reportService.isSelectorOpen.set(true);
  }

  async onPerspectiveSelected(type: 'buyer' | 'renter') {
    this.reportService.isSelectorOpen.set(false);
    if (!this.model || this.model.id !== 'property' || !this.model.coords) return;
    
    const addressSection = this.model.sections.find((section) => section.title === 'Address');
    const rawDescription = addressSection?.description?.trim();
    if (!rawDescription) return;

    const primaryAddress = rawDescription
      .split('Territorial Authority:')[0]
      .replace(/\.+$/, '')
      .trim();

    // Start report generation instantly. 
    // The backend AgentService will handle data gathering (including flood data where possible)
    // to avoid blocking the UI with browser-side fetches.
    this.reportService.generateReport(
      this.model.coords.lat,
      this.model.coords.lng,
      primaryAddress,
      type,
      null // Pass null, let the backend handle it
    ).subscribe();
  }
}
