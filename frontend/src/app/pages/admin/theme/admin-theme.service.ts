/**
 * Admin theme-editor data service (P1a WU10).
 *
 * Wires the theme editor to the WU4a (read) + WU4b (mutate) endpoints via the
 * shared {@link ApiService}, mirroring the other `admin-*.service.ts` seams. It
 * is also the concrete {@link ThemeResetService} the WU9 panic frame declared —
 * so a single injectable both drives the editor and backs the always-mounted
 * reset overlay (bound `{ provide: ThemeResetService, useExisting: AdminThemeService }`).
 *
 * Every method is a thin, typed pass-through to `/api/v1/theme/...`; the
 * component owns the state machine, staleness handling and error surfacing.
 */

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from '../../../core/api.service';
import { ThemeResetService } from '../../../shared/theme-reset-frame.component';

/** Lifecycle status of a theme document (mirrors backend `ThemeStatus`). */
export type ThemeStatus = 'draft' | 'published';

/** A resolved theme document (published or draft) — mirrors `ThemeTokensRead`. */
export interface ThemeTokensRead {
  readonly tokens: Record<string, string>;
  readonly version: number;
  readonly schema_version: number;
  readonly status: ThemeStatus;
  readonly published_at?: string | null;
  readonly updated_at?: string | null;
}

/** One entry in the browsable version history — mirrors `ThemeVersionListItem`. */
export interface ThemeVersionListItem {
  readonly version: number;
  readonly schema_version: number;
  readonly status: ThemeStatus;
  readonly created_by_user_id?: string | null;
  readonly published_at?: string | null;
  readonly created_at: string;
}

/** The version-history list wrapper — mirrors `ThemeVersionListResponse`. */
export interface ThemeVersionListResponse {
  readonly items: readonly ThemeVersionListItem[];
}

@Injectable({ providedIn: 'root' })
export class AdminThemeService extends ThemeResetService {
  constructor(private readonly api: ApiService) {
    super();
  }

  /** Current PUBLISHED tokens (public/SSR consumer surface). */
  getPublished(): Observable<ThemeTokensRead> {
    return this.api.get<ThemeTokensRead>('/theme');
  }

  /** Current editable DRAFT (admin only). */
  getDraft(): Observable<ThemeTokensRead> {
    return this.api.get<ThemeTokensRead>('/theme/draft');
  }

  /** Browsable version history, newest first (admin only). */
  listVersions(): Observable<ThemeVersionListResponse> {
    return this.api.get<ThemeVersionListResponse>('/theme/versions');
  }

  /** Save the editable-token map as the draft (server-revalidated + audited). */
  saveDraft(tokens: Record<string, string>): Observable<ThemeTokensRead> {
    return this.api.put<ThemeTokensRead>('/theme/draft', { tokens });
  }

  /**
   * Atomically publish the draft. `expectedVersion` carries the optimistic
   * concurrency guard — the server rejects a stale publish 409, and a
   * contrast-failing effective set 422.
   */
  publish(expectedVersion: number | null): Observable<ThemeTokensRead> {
    return this.api.post<ThemeTokensRead>('/theme/publish', {
      expected_version: expectedVersion,
    });
  }

  /** Wholesale-restore a prior PUBLISHED version (preview-gated by WU12). */
  rollback(version: number): Observable<ThemeTokensRead> {
    return this.api.post<ThemeTokensRead>(`/theme/rollback/${version}`, {});
  }

  /**
   * Force-publish the seeded compiled defaults — the WU9 panic-reset target.
   * Bypasses only the staleness guard; still audited server-side.
   */
  override resetToDefault(): Observable<ThemeTokensRead> {
    return this.api.post<ThemeTokensRead>('/theme/reset-to-default', {});
  }
}
