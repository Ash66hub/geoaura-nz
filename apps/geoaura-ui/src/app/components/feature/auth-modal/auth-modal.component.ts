import { Component, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

type AuthView = 'login' | 'magic-link-sent';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss',
})
export class AuthModalComponent {
  @Output() close = new EventEmitter<void>();

  protected authService = inject(AuthService);

  view = signal<AuthView>('login');
  email = signal('');
  isLoading = signal(false);
  errorMsg = signal<string | null>(null);
  sentEmail = signal('');

  async onGoogleSignIn() {
    this.errorMsg.set(null);
    this.isLoading.set(true);
    try {
      await this.authService.signInWithGoogle();
    } catch {
      this.errorMsg.set('Google sign-in failed. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onMagicLinkSubmit() {
    const emailVal = this.email().trim();
    if (!emailVal) {
      this.errorMsg.set('Please enter your email address.');
      return;
    }
    this.errorMsg.set(null);
    this.isLoading.set(true);
    try {
      const { error } = await this.authService.signInWithMagicLink(emailVal);
      if (error) throw error;
      this.sentEmail.set(emailVal);
      this.view.set('magic-link-sent');
    } catch (err: any) {
      this.errorMsg.set(err?.message ?? 'Failed to send supabase auth link. Try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close.emit();
    }
  }
}
