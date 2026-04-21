import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MapExplorerComponent } from './components/feature/map-explorer/map-explorer.component';
import { ReportViewerComponent } from './components/feature/report-viewer/report-viewer.component';
import { ReportService } from './services/report.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MapExplorerComponent, ReportViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('geoaura-ui');
  public reportService = inject(ReportService);
}
