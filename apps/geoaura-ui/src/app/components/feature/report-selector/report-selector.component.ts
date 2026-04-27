import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-report-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './report-selector.component.html',
  styleUrl: './report-selector.component.scss'
})
export class ReportSelectorComponent {
  @Output() select = new EventEmitter<'buyer' | 'renter'>();
  @Output() close = new EventEmitter<void>();

  onSelect(type: 'buyer' | 'renter') {
    this.select.emit(type);
  }

  onClose() {
    this.close.emit();
  }
}
