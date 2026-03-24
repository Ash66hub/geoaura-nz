import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

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
}

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [CommonModule],
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

  private readonly sourceLinks: Record<string, string> = {
    geonet: 'https://www.geonet.org.nz/',
    'gns science': 'https://www.gns.cri.nz/',
    niwa: 'https://niwa.co.nz/',
    linz: 'https://www.linz.govt.nz/',
    'waikato regional council': 'https://www.waikatoregion.govt.nz/',
  };

  onToggleMinimize() {
    this.toggleMinimize.emit();
  }

  onInfoModeChange(mode: DetailPanelInfoMode) {
    if (mode === this.infoMode) return;
    this.infoModeChange.emit(mode);
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
}
