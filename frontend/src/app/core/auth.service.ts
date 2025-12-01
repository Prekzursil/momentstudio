import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ApiService } from './api.service';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<AuthUser | null>(this.loadUser());
  private tokens: AuthTokens | null = this.loadTokens();

  constructor(private api: ApiService, private router: Router) {}

  user = () => this.userSignal();

  isAuthenticated(): boolean {
    return Boolean(this.tokens?.access_token);
  }

  role(): string | null {
    return this.userSignal()?.role ?? null;
  }

  getAccessToken(): string | null {
    return this.tokens?.access_token ?? null;
  }

  getRefreshToken(): string | null {
    return this.tokens?.refresh_token ?? null;
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.api.post<AuthResponse>('/auth/login', { email, password }).pipe(tap((res) => this.persist(res)));
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.api.post<AuthResponse>('/auth/register', { name, email, password }).pipe(tap((res) => this.persist(res)));
  }

  changePassword(current: string, newPassword: string): Observable<{ detail: string }> {
    return this.api.post<{ detail: string }>('/auth/password/change', {
      current_password: current,
      new_password: newPassword
    });
  }

  refresh(): Observable<AuthTokens | null> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return of(null);
    return this.api.post<AuthResponse>('/auth/refresh', { refresh_token: refreshToken }).pipe(
      tap((res) => this.persist(res)),
      map((res) => res.tokens)
    );
  }

  logout(): Observable<void> {
    const refreshToken = this.getRefreshToken();
    this.clear();
    if (!refreshToken) return of(void 0);
    return this.api.post<void>('/auth/logout', { refresh_token: refreshToken }).pipe(
      catchError(() => of(void 0)),
      map(() => void 0)
    );
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.api.post<void>('/auth/password-reset/request', { email });
  }

  confirmPasswordReset(token: string, newPassword: string): Observable<void> {
    return this.api.post<void>('/auth/password-reset/confirm', { token, new_password: newPassword });
  }

  loadCurrentUser(): Observable<AuthUser> {
    return this.api.get<AuthUser>('/auth/me').pipe(tap((user) => this.setUser(user)));
  }

  private persist(res: AuthResponse): void {
    this.tokens = res.tokens;
    this.setUser(res.user);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('auth_tokens', JSON.stringify(res.tokens));
      localStorage.setItem('auth_user', JSON.stringify(res.user));
      localStorage.setItem('auth_role', res.user.role);
    }
  }

  private setUser(user: AuthUser | null): void {
    this.userSignal.set(user);
    if (typeof localStorage !== 'undefined') {
      if (user) {
        localStorage.setItem('auth_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('auth_user');
      }
    }
  }

  private clear(): void {
    this.tokens = null;
    this.userSignal.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('auth_tokens');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_role');
    }
    this.router.navigateByUrl('/');
  }

  private loadTokens(): AuthTokens | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('auth_tokens');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthTokens;
    } catch {
      return null;
    }
  }

  private loadUser(): AuthUser | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('auth_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }
}
