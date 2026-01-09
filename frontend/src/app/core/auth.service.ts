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
  username: string;
  name?: string | null;
  name_tag?: number;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  email_verified?: boolean;
  notify_blog_comments?: boolean;
  notify_blog_comment_replies?: boolean;
  notify_marketing?: boolean;
  google_sub?: string | null;
  google_email?: string | null;
  google_picture_url?: string | null;
  preferred_language?: string | null;
  role: string;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface GoogleCallbackResponse {
  user: AuthUser;
  tokens?: AuthTokens | null;
  requires_completion?: boolean;
  completion_token?: string | null;
}

export interface UsernameHistoryItem {
  username: string;
  created_at: string;
}

export interface DisplayNameHistoryItem {
  name: string;
  name_tag: number;
  created_at: string;
}

export interface UserAliasesResponse {
  usernames: UsernameHistoryItem[];
  display_names: DisplayNameHistoryItem[];
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

  login(identifier: string, password: string, captchaToken?: string): Observable<AuthResponse> {
    return this.api
      .post<AuthResponse>('/auth/login', { identifier, password, captcha_token: captchaToken ?? null })
      .pipe(tap((res) => this.persist(res)));
  }

  register(payload: {
    name: string;
    username: string;
    email: string;
    password: string;
    first_name: string;
    middle_name?: string | null;
    last_name: string;
    date_of_birth: string;
    phone: string;
    preferred_language?: string;
    captcha_token?: string | null;
  }): Observable<AuthResponse> {
    return this.api.post<AuthResponse>('/auth/register', payload).pipe(tap((res) => this.persist(res)));
  }

  changePassword(current: string, newPassword: string): Observable<{ detail: string }> {
    return this.api.post<{ detail: string }>('/auth/password/change', {
      current_password: current,
      new_password: newPassword
    });
  }

  startGoogleLogin(): Observable<string> {
    return this.api.get<{ auth_url: string }>('/auth/google/start').pipe(map((res) => res.auth_url));
  }

  completeGoogleLogin(code: string, state: string): Observable<GoogleCallbackResponse> {
    return this.api.post<GoogleCallbackResponse>('/auth/google/callback', { code, state }).pipe(
      tap((res) => {
        if (res.tokens) {
          this.persist({ user: res.user, tokens: res.tokens });
        }
      })
    );
  }

  completeGoogleRegistration(
    completionToken: string,
    payload: {
      username: string;
      name: string;
      first_name: string;
      middle_name?: string | null;
      last_name: string;
      date_of_birth: string;
      phone: string;
      password: string;
      preferred_language?: string;
    }
  ): Observable<AuthResponse> {
    return this.api
      .post<AuthResponse>('/auth/google/complete', payload, { Authorization: `Bearer ${completionToken}` })
      .pipe(tap((res) => this.persist(res)));
  }

  startGoogleLink(): Observable<string> {
    return this.api.get<{ auth_url: string }>('/auth/google/link/start').pipe(map((res) => res.auth_url));
  }

  completeGoogleLink(code: string, state: string, password: string): Observable<AuthUser> {
    return this.api.post<AuthUser>('/auth/google/link', { code, state, password }).pipe(
      tap((user) => this.setUser(user))
    );
  }

  unlinkGoogle(password: string): Observable<AuthUser> {
    return this.api.post<AuthUser>('/auth/google/unlink', { password }).pipe(tap((user) => this.setUser(user)));
  }

  uploadAvatar(file: File): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<AuthUser>('/auth/me/avatar', formData).pipe(tap((user) => this.setUser(user)));
  }

  useGoogleAvatar(): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.post<AuthUser>('/auth/me/avatar/use-google', {}).pipe(tap((user) => this.setUser(user)));
  }

  removeAvatar(): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.delete<AuthUser>('/auth/me/avatar').pipe(tap((user) => this.setUser(user)));
  }

  updatePreferredLanguage(lang: string): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me/language', { preferred_language: lang }).pipe(
      tap((user) => {
        this.setUser(user);
      })
    );
  }

  updateNotificationPreferences(payload: {
    notify_blog_comments?: boolean | null;
    notify_blog_comment_replies?: boolean | null;
    notify_marketing?: boolean | null;
  }): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me/notifications', payload).pipe(tap((user) => this.setUser(user)));
  }

  updateProfile(payload: {
    name?: string | null;
    phone?: string | null;
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
    date_of_birth?: string | null;
    preferred_language?: string | null;
  }): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me', payload).pipe(tap((user) => this.setUser(user)));
  }

  updateUsername(username: string): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me/username', { username }).pipe(tap((user) => this.setUser(user)));
  }

  updateEmail(email: string, password: string): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me/email', { email, password }).pipe(tap((user) => this.setUser(user)));
  }

  getAliases(): Observable<UserAliasesResponse> {
    return this.api.get<UserAliasesResponse>('/auth/me/aliases');
  }

  requestEmailVerification(): Observable<{ detail: string }> {
    return this.api.post<{ detail: string }>('/auth/verify/request', {});
  }

  confirmEmailVerification(token: string): Observable<{ detail: string; email_verified: boolean }> {
    return this.api.post<{ detail: string; email_verified: boolean }>('/auth/verify/confirm', { token });
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
    void this.router.navigateByUrl('/');
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
