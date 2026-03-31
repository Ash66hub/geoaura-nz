import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrimePieChartComponent } from '../../shared/crime-pie-chart/crime-pie-chart.component';

export type DetailPanelInfoMode = 'layer' | 'property';

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
  symbolType?:
    | 'fill-hazard'
    | 'fill-flood'
    | 'point-gauge'
    | 'line-river'
    | 'point-seismic'
    | 'line-fault';
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
  };
}

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [CommonModule, CrimePieChartComponent],
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
  showRateInfo = false;

  private readonly sourceLinks: Record<string, string> = {
    geonet: 'https://www.geonet.org.nz/',
    'gns science': 'https://www.gns.cri.nz/',
    niwa: 'https://niwa.co.nz/',
    linz: 'https://www.linz.govt.nz/',
    'nz police':
      'https://www.police.govt.nz/about-us/publications-statistics/data-and-statistics/policedatanz/',
    'waikato regional council': 'https://www.waikatoregion.govt.nz/',
  };

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

  getRateDescription(): string {
    return 'Rate is incident density: total victimisations in this meshblock divided by land area in square kilometres (incidents per km^2) for Feb 2025 to Jan 2026.';
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
}
