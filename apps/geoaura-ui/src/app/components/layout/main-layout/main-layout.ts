import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MapExplorerComponent } from '../../feature/map-explorer/map-explorer.component';
import { ReportViewerComponent } from '../../feature/report-viewer/report-viewer.component';
import { ReportsPanelComponent } from '../../feature/reports-panel/reports-panel.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { ReportService } from '../../../services/report.service';

@Component({
  selector: 'app-main-layout',
  imports: [RouterModule, MapExplorerComponent, ReportViewerComponent, ReportsPanelComponent, TopBarComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  public reportService = inject(ReportService);
}
