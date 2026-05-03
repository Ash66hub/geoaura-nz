import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-terms-of-service',
  imports: [RouterModule],
  templateUrl: './terms-of-service.html',
  styleUrl: './terms-of-service.scss',
})
export class TermsOfServiceComponent {
  currentYear = new Date().getFullYear();
}
