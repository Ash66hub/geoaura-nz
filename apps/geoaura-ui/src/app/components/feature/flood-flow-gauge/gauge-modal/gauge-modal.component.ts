import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GaugeProperties } from '../../../../common/flood-flow-gauge';

@Component({
  selector: 'app-gauge-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './gauge-modal.component.html',
  styleUrl: './gauge-modal.component.scss',
})
export class GaugeModalComponent {
  @Input({ required: true }) properties!: GaugeProperties;
  @Output() close = new EventEmitter<void>();

  get floodStats() {
    if (!this.properties) return [];

    return [
      {
        period: '2.33-yr',
        aep: '43%',
        flow: this.properties.L1_mean,
        error: this.properties.se_2_33y,
      },
      { period: '5-yr', aep: '20%', flow: this.properties.Data_5y, error: this.properties.se_5y },
      {
        period: '10-yr',
        aep: '10%',
        flow: this.properties.Data_10y,
        error: this.properties.se_10y,
      },
      { period: '50-yr', aep: '2%', flow: this.properties.Data_50y, error: this.properties.se_50y },
      {
        period: '100-yr',
        aep: '1%',
        flow: this.properties.Data_100y,
        error: this.properties.se_100y,
      },
      {
        period: '500-yr',
        aep: '0.2%',
        flow: this.properties.Data_500y,
        error: this.properties.se_500y,
      },
    ];
  }
}
