import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
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

type StorageMode = 'local' | 'session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private storageMode: StorageMode = 'session';
  private userSignal = signal<AuthUser | null>(null);
  private tokens: AuthTokens | null = null;

  constructor(private api: ApiService, private router: Router) {
    this.bootstrap();
  }

  user = () => this.userSignal();

  isAuthenticated(): boolean {
    return Boolean(this.userSignal() && (this.hasValidAccessToken() || this.hasValidRefreshToken()));
  }

  role(): string | null {
    return this.userSignal()?.role ?? null;
  }

  isAdmin(): boolean {
    const role = this.role();
    return role === 'admin' || role === 'owner';
  }

  getAccessToken(): string | null {
    return this.tokens?.access_token ?? null;
  }

  getRefreshToken(): string | null {
    return this.tokens?.refresh_token ?? null;
  }

  login(
    identifier: string,
    password: string,
    captchaToken?: string,
    opts?: { remember?: boolean }
  ): Observable<AuthResponse> {
    return this.api
      .post<AuthResponse>('/auth/login', { identifier, password, captcha_token: captchaToken ?? null })
      .pipe(tap((res) => this.persist(res, opts?.remember ?? false)));
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
  }, opts?: { remember?: boolean }): Observable<AuthResponse> {
    return this.api
      .post<AuthResponse>('/auth/register', payload)
      .pipe(tap((res) => this.persist(res, opts?.remember ?? false)));
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
          this.persist({ user: res.user, tokens: res.tokens }, false);
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
      .pipe(tap((res) => this.persist(res, false)));
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

  updateUsername(username: string, password: string): Observable<AuthUser> {
    if (!this.isAuthenticated()) {
      return of({} as AuthUser);
    }
    return this.api.patch<AuthUser>('/auth/me/username', { username, password }).pipe(tap((user) => this.setUser(user)));
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
    if (this.isJwtExpired(refreshToken)) return of(null);
    return this.api.post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken }).pipe(
      tap((tokens) => this.setTokens(tokens)),
      catchError(() => of(null))
    );
  }

  logout(): Observable<void> {
    const refreshToken = this.getRefreshToken();
    const accessToken = this.getAccessToken();
    this.clearSession({ redirectTo: '/' });
    if (!refreshToken) return of(void 0);
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    return this.api.post<void>('/auth/logout', { refresh_token: refreshToken }, headers).pipe(
      catchError(() => of(void 0)),
      map(() => void 0)
    );
  }

  expireSession(): void {
    this.clearSession({ redirectTo: '/login' });
  }

  clearSession(opts?: { redirectTo?: string }): void {
    this.clearStorage();
    this.tokens = null;
    this.userSignal.set(null);
    this.storageMode = 'session';
    if (opts?.redirectTo) {
      void this.router.navigateByUrl(opts.redirectTo);
    }
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

  ensureAuthenticated(): Observable<boolean> {
    if (!this.tokens) return of(false);
    if (this.hasValidAccessToken()) {
      return this.loadCurrentUser().pipe(
        map(() => true),
        catchError((err) => {
          if (err?.status === 401 || err?.status === 403) {
            this.clearSession();
            return of(false);
          }
          return of(true);
        })
      );
    }
    if (!this.hasValidRefreshToken()) {
      this.clearSession();
      return of(false);
    }
    return this.refresh().pipe(
      switchMap((tokens) => {
        if (!tokens) {
          this.clearSession();
          return of(false);
        }
        return this.loadCurrentUser().pipe(
          map(() => true),
          catchError((err) => {
            if (err?.status === 401 || err?.status === 403) {
              this.clearSession();
              return of(false);
            }
            return of(true);
          })
        );
      })
    );
  }

  bootstrap(): void {
    const loaded = this.loadPersisted();
    this.tokens = loaded.tokens;
    this.storageMode = loaded.mode;
    this.userSignal.set(loaded.user);

    // If both tokens are fully expired, wipe persisted state to avoid
    // "logged in but unauthorized" UI after restarts.
    if (this.tokens) {
      const accessExpired = this.isJwtExpired(this.tokens.access_token);
      const refreshExpired = this.isJwtExpired(this.tokens.refresh_token);
      if (accessExpired && refreshExpired) {
        this.clearSession();
      }
    }
  }

  private persist(res: AuthResponse, remember: boolean): void {
    this.storageMode = remember ? 'local' : 'session';
    this.tokens = res.tokens;
    this.setUser(res.user);
    this.persistTokens(res.tokens);
    this.persistRole(res.user.role);
    // Ensure we don't keep stale sessions in the other storage backend.
    this.clearStorage(this.storageMode === 'local' ? 'session' : 'local');
  }

  setTokens(tokens: AuthTokens | null): void {
    this.tokens = tokens;
    if (!tokens) {
      this.clearStorage();
      return;
    }
    this.persistTokens(tokens);
  }

  private setUser(user: AuthUser | null): void {
    this.userSignal.set(user);
    if (!user) {
      this.removeFromStorage('auth_user');
      return;
    }
    this.writeToStorage('auth_user', JSON.stringify(user));
  }

  private loadPersisted(): { tokens: AuthTokens | null; user: AuthUser | null; mode: StorageMode } {
    const sessionTokens = this.loadTokensFrom('session');
    const localTokens = this.loadTokensFrom('local');
    if (sessionTokens) {
      return { tokens: sessionTokens, user: this.loadUserFrom('session'), mode: 'session' };
    }
    if (localTokens) {
      return { tokens: localTokens, user: this.loadUserFrom('local'), mode: 'local' };
    }
    return { tokens: null, user: null, mode: 'session' };
  }

  private loadTokensFrom(mode: StorageMode): AuthTokens | null {
    const raw = this.readFromStorage('auth_tokens', mode);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthTokens;
    } catch {
      return null;
    }
  }

  private loadUserFrom(mode: StorageMode): AuthUser | null {
    const raw = this.readFromStorage('auth_user', mode);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  private hasValidAccessToken(): boolean {
    const token = this.tokens?.access_token;
    return Boolean(token && !this.isJwtExpired(token));
  }

  private hasValidRefreshToken(): boolean {
    const token = this.tokens?.refresh_token;
    return Boolean(token && !this.isJwtExpired(token));
  }

  private parseJwtExpiry(token: string): number | null {
    const raw = (token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }

  private isJwtExpired(token: string, skewSeconds = 30): boolean {
    const exp = this.parseJwtExpiry(token);
    if (!exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return exp <= now + Math.max(0, skewSeconds);
  }

  private persistTokens(tokens: AuthTokens): void {
    this.writeToStorage('auth_tokens', JSON.stringify(tokens));
  }

  private persistRole(role: string): void {
    this.writeToStorage('auth_role', String(role || ''));
  }

  private writeToStorage(key: string, value: string): void {
    const storage = this.getStorage(this.storageMode);
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      // ignore (e.g., blocked storage)
    }
  }

  private readFromStorage(key: string, mode: StorageMode): string | null {
    const storage = this.getStorage(mode);
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  private removeFromStorage(key: string): void {
    for (const mode of ['local', 'session'] as const) {
      const storage = this.getStorage(mode);
      if (!storage) continue;
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }

  private clearStorage(mode?: StorageMode): void {
    const modes: StorageMode[] = mode ? [mode] : ['local', 'session'];
    for (const m of modes) {
      const storage = this.getStorage(m);
      if (!storage) continue;
      try {
        storage.removeItem('auth_tokens');
        storage.removeItem('auth_user');
        storage.removeItem('auth_role');
      } catch {
        // ignore
      }
    }
  }

  private getStorage(mode: StorageMode): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return mode === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  }
}
