import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { ApiService } from './api.service';
import { finalize, shareReplay } from 'rxjs/operators';

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

export interface SecondaryEmail {
  id: string;
  email: string;
  verified: boolean;
  verified_at?: string | null;
  created_at: string;
}

export interface UserEmailsResponse {
  primary_email: string;
  primary_verified: boolean;
  secondary_emails: SecondaryEmail[];
}

export interface RefreshSessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  persistent: boolean;
  is_current: boolean;
  user_agent?: string | null;
  ip_address?: string | null;
}

export interface RefreshSessionsRevokeResponse {
  revoked: number;
}

export interface UserSecurityEventInfo {
  id: string;
  event_type: string;
  created_at: string;
  user_agent?: string | null;
  ip_address?: string | null;
}

type StorageMode = 'local' | 'session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private storageMode: StorageMode = 'session';
  private userSignal = signal<AuthUser | null>(null);
  private tokens: AuthTokens | null = null;
  private refreshInFlight: Observable<AuthTokens | null> | null = null;
  private ensureInFlight: Observable<boolean> | null = null;
  private lastRevalidateAt = 0;

  constructor(private api: ApiService, private router: Router) {
    this.bootstrap();
    this.installRevalidationHooks();
  }

  user = () => this.userSignal();

  isAuthenticated(): boolean {
    return Boolean(this.userSignal());
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
      .post<AuthResponse>('/auth/login', {
        identifier,
        password,
        captcha_token: captchaToken ?? null,
        remember: opts?.remember ?? false
      })
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

  listEmails(): Observable<UserEmailsResponse> {
    return this.api.get<UserEmailsResponse>('/auth/me/emails');
  }

  addSecondaryEmail(email: string): Observable<SecondaryEmail> {
    return this.api.post<SecondaryEmail>('/auth/me/emails', { email });
  }

  requestSecondaryEmailVerification(secondaryEmailId: string): Observable<{ detail: string }> {
    return this.api.post<{ detail: string }>(`/auth/me/emails/${secondaryEmailId}/verify/request`, {});
  }

  confirmSecondaryEmailVerification(token: string): Observable<SecondaryEmail> {
    return this.api.post<SecondaryEmail>('/auth/me/emails/verify/confirm', { token });
  }

  deleteSecondaryEmail(secondaryEmailId: string): Observable<void> {
    return this.api.delete<void>(`/auth/me/emails/${secondaryEmailId}`);
  }

  makeSecondaryEmailPrimary(secondaryEmailId: string, password: string): Observable<AuthUser> {
    return this.api
      .post<AuthUser>(`/auth/me/emails/${secondaryEmailId}/make-primary`, { password })
      .pipe(tap((user) => this.setUser(user)));
  }

  listSessions(): Observable<RefreshSessionInfo[]> {
    return this.api.get<RefreshSessionInfo[]>('/auth/me/sessions');
  }

  revokeOtherSessions(): Observable<RefreshSessionsRevokeResponse> {
    return this.api.post<RefreshSessionsRevokeResponse>('/auth/me/sessions/revoke-others', {});
  }

  listSecurityEvents(limit: number = 30): Observable<UserSecurityEventInfo[]> {
    return this.api.get<UserSecurityEventInfo[]>('/auth/me/security-events', { limit });
  }

  refresh(opts?: { silent?: boolean }): Observable<AuthTokens | null> {
    const silent = opts?.silent ?? false;
    const headers = silent ? { 'X-Silent': '1' } : undefined;

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refreshToken = this.getRefreshToken();
    const body = refreshToken && !this.isJwtExpired(refreshToken) ? { refresh_token: refreshToken } : {};
    const refresh$ = this.api.post<AuthTokens>('/auth/refresh', body, headers).pipe(
      tap((tokens) => this.setTokens(tokens)),
      map((tokens) => tokens),
      catchError(() => of(null)),
      finalize(() => {
        this.refreshInFlight = null;
      }),
      shareReplay(1)
    );

    this.refreshInFlight = refresh$;
    return refresh$;
  }

  logout(): Observable<void> {
    const refreshToken = this.getRefreshToken();
    const accessToken = this.getAccessToken();
    this.clearSession({ redirectTo: '/' });
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    const body = refreshToken ? { refresh_token: refreshToken } : {};
    return this.api.post<void>('/auth/logout', body, headers).pipe(
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

  ensureAuthenticated(opts?: { silent?: boolean }): Observable<boolean> {
    const silent = opts?.silent ?? false;
    const headers = silent ? { 'X-Silent': '1' } : undefined;

    if (this.ensureInFlight) {
      return this.ensureInFlight;
    }

    const me = () =>
      this.api.get<AuthUser>('/auth/me', undefined, headers).pipe(
        tap((user) => this.setUser(user)),
        map(() => true)
      );

    const ensure$ = (this.hasValidAccessToken()
      ? me()
      : (() => {
          return this.refresh({ silent }).pipe(
            switchMap((tokens) => {
              if (!tokens) {
                this.clearSession();
                return of(false);
              }
              return me();
            })
          );
        })()
    ).pipe(
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
      finalize(() => {
        this.ensureInFlight = null;
      }),
      shareReplay(1)
    );

    this.ensureInFlight = ensure$;
    return ensure$;
  }

  bootstrap(): void {
    const loaded = this.loadPersisted();
    this.tokens = loaded.tokens;
    this.storageMode = loaded.mode;
    // Cookies are the source of truth for refresh sessions. Clear any legacy
    // persisted tokens/user state (localStorage/sessionStorage).
    this.userSignal.set(null);
    this.clearStorage();

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

  private installRevalidationHooks(): void {
    if (typeof window === 'undefined') return;
    const cooldownMs = 10_000;
    const revalidate = () => {
      const now = Date.now();
      if (now - this.lastRevalidateAt < cooldownMs) return;
      this.lastRevalidateAt = now;
      this.ensureAuthenticated({ silent: true }).subscribe({ error: () => void 0 });
    };

    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        revalidate();
      }
    });
  }

  private persist(res: AuthResponse, remember: boolean): void {
    this.tokens = res.tokens;
    this.setUser(res.user);
    // Cookies are the source of truth for refresh sessions. Clear any legacy
    // persisted tokens/user state to avoid stale \"logged in\" UI after reloads.
    this.clearStorage();
    this.storageMode = remember ? 'local' : 'session';
  }

  setTokens(tokens: AuthTokens | null): void {
    this.tokens = tokens;
    if (!tokens) {
      this.clearStorage();
      return;
    }
    // Do not persist tokens (cookie-based refresh sessions).
    this.clearStorage();
  }

  private setUser(user: AuthUser | null): void {
    this.userSignal.set(user);
    // Never persist user state (avoid stale \"logged in\" UI after reloads).
    this.removeFromStorage('auth_user');
    this.removeFromStorage('auth_role');
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
    // If we can't parse expiry, treat as expired (invalid/stale token).
    if (!exp) return true;
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
