import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { User, Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabaseService = inject(SupabaseService);

  private _session = signal<Session | null>(null);
  private _loading = signal(true);

  readonly session = this._session.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly user = computed<AuthUser | null>(() => {
    const s = this._session();
    if (!s) return null;
    const meta = s.user.user_metadata ?? {};
    return {
      id: s.user.id,
      email: s.user.email ?? null,
      name: meta['full_name'] ?? meta['name'] ?? null,
      avatarUrl: meta['avatar_url'] ?? meta['picture'] ?? null,
    };
  });

  readonly isLoggedIn = computed(() => !!this._session());

  // Shared modal state — lifted to root so the modal always renders above everything
  readonly showAuthModal = signal(false);

  openAuthModal() { this.showAuthModal.set(true); }
  closeAuthModal() { this.showAuthModal.set(false); }

  constructor() {
    this.supabaseService.getSession().then((session) => {
      this._session.set(session);
      this._loading.set(false);
    });

    this.supabaseService.onAuthStateChange((session) => {
      this._session.set(session);
      this._loading.set(false);
    });
  }

  async signInWithGoogle() {
    await this.supabaseService.signInWithGoogle();
  }

  async signInWithMagicLink(email: string) {
    return this.supabaseService.signInWithMagicLink(email);
  }

  async signOut() {
    await this.supabaseService.signOut();
    this._session.set(null);
  }
}
