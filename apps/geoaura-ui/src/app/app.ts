import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MapExplorerComponent } from './components/map-explorer.component/map-explorer.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MapExplorerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('geoaura-ui');
}
