import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

interface CrimeData {
  label: string;
  value: number;
}

@Component({
  selector: 'app-crime-pie-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="crime-chart-container">
      <div class="chart-wrapper">
        <canvas #chartCanvas></canvas>
      </div>
      <div class="chart-legend">
        <div class="legend-title">Crime Breakdown</div>
        <div class="legend-items">
          @for (item of crimeData; track item.label) {
            <div class="legend-item">
              <span class="legend-color" [style.background-color]="getColorForIndex($index)"></span>
              <span class="legend-label">{{ item.label }}</span>
              <span class="legend-value">{{ item.value }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .crime-chart-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        padding: 1rem 0;
      }

      .chart-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 320px;
      }

      canvas {
        max-width: 100%;
        max-height: 300px;
      }

      .chart-legend {
        width: 100%;
        display: flex;
        flex-direction: column;
        max-width: 520px;
      }

      .legend-title {
        font-weight: 600;
        font-size: 0.875rem;
        color: #374151;
        margin-bottom: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .legend-items {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.5rem;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
        padding: 0.25rem 0;
      }

      .legend-color {
        width: 12px;
        height: 12px;
        border-radius: 2px;
        flex-shrink: 0;
      }

      .legend-label {
        flex: 1;
        color: #4b5563;
        word-break: break-word;
      }

      .legend-value {
        font-weight: 600;
        color: #1f2937;
        white-space: nowrap;
        margin-left: 0.25rem;
      }

      @media (max-width: 640px) {
        .legend-items {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class CrimePieChartComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() crimeData: CrimeData[] = [];
  @ViewChild('chartCanvas', { static: false }) chartCanvas!: ElementRef<HTMLCanvasElement>;

  private chart: Chart | null = null;
  private readonly chartColors = [
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Yellow
    '#22c55e', // Green
    '#06b6d4', // Cyan
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f43f5e', // Rose
    '#6366f1', // Indigo
    '#14b8a6', // Teal
    '#a855f7', // Violet
  ];

  ngAfterViewInit() {
    this.createChart();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['crimeData'] && this.chartCanvas) {
      this.createChart();
    }
  }

  ngOnDestroy() {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  private createChart() {
    if (!this.chartCanvas || !this.crimeData.length) return;

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    // Prepare data
    const labels = this.crimeData.map((d) => d.label);
    const data = this.crimeData.map((d) => d.value);
    const colors = labels.map((_, i) => this.getColorForIndex(i));

    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: 12,
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value} (${percentage}%)`;
              },
            },
          },
        },
      },
    };

    if (this.chart) {
      this.chart.destroy();
    }

    this.chart = new Chart(ctx, config);
  }

  getColorForIndex(index: number): string {
    return this.chartColors[index % this.chartColors.length];
  }
}
