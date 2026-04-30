import { Component, inject, signal, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../services/auth.service';
import { AuthModalComponent } from '../../feature/auth-modal/auth-modal.component';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [CommonModule, AuthModalComponent],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.scss',
})
export class TopBarComponent {
  protected authService = inject(AuthService);
  private elRef = inject(ElementRef);

  showUserMenu = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (
      this.showUserMenu() &&
      !(this.elRef.nativeElement as HTMLElement).contains(event.target as Node)
    ) {
      this.showUserMenu.set(false);
    }
  }

  openAuthModal() {
    this.authService.openAuthModal();
  }

  closeAuthModal() {
    this.authService.closeAuthModal();
  }

  toggleUserMenu() {
    this.showUserMenu.update((v) => !v);
  }

  async signOut() {
    await this.authService.signOut();
    this.showUserMenu.set(false);
  }
}
