import { Injectable } from '@angular/core';

import type {
  BlogDraftState,
  HomeBlockDraft,
  PageBlocksDraftState,
  PageBuilderKey,
  UiLang,
} from '../admin.component';

/**
 * Truly-shared CMS editing state extracted from AdminComponent.
 *
 * Owns the per-editor undo/redo + autosave draft managers (home sections,
 * page builders, blog posts) and their factory/mutator surface. AdminComponent
 * delegates to this service so the same draft state is a single, injectable
 * unit. Provided at the component level (see AdminComponent providers) so the
 * draft managers keep their previous per-component-instance lifetime rather
 * than becoming a cross-instance singleton.
 *
 * Behaviour-preserving: the CmsDraftManager class and the ensure* factories
 * are moved verbatim; no logic changed.
 */

export type CmsAutosaveEnvelope = {
  v: 1;
  ts: string;
  state_json: string;
};

export class CmsDraftManager<T> {
  private initialized = false;
  private past: string[] = [];
  private future: string[] = [];
  private present = '';
  private server = '';
  private restoreCandidate: CmsAutosaveEnvelope | null = null;
  private pending: string | null = null;
  private pendingTimer: number | null = null;
  dirty = false;
  autosavePending = false;
  lastAutosavedAt: string | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly opts: { debounceMs: number; limit: number } = { debounceMs: 650, limit: 60 },
  ) {}

  get hasRestorableAutosave(): boolean {
    return Boolean(this.restoreCandidate?.state_json);
  }

  get restorableAutosaveAt(): string | null {
    return this.restoreCandidate?.ts || null;
  }

  isReady(): boolean {
    return this.initialized;
  }

  initFromServer(state: T): void {
    const serialized = this.serialize(state);
    this.initialized = true;
    this.past = [];
    this.future = [];
    this.present = serialized;
    this.server = serialized;
    this.pending = null;
    this.clearPendingTimer();
    this.dirty = false;
    this.autosavePending = false;
    this.lastAutosavedAt = null;
    this.restoreCandidate = this.readAutosaveCandidate(serialized);
  }

  markServerSaved(state: T, clearAutosave = true): void {
    if (!this.initialized) return;
    this.commitNow(state);
    this.server = this.present;
    this.dirty = false;
    if (clearAutosave) this.clearAutosave();
  }

  observe(state: T): void {
    if (!this.initialized) return;
    const serialized = this.serialize(state);
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    this.pending = serialized;
    this.autosavePending = true;
    this.resetCommitTimer();
  }

  canUndo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    return this.past.length > 0 || serialized !== this.present;
  }

  canRedo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    if (serialized !== this.present) return false;
    return this.future.length > 0;
  }

  undo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.past.length) return null;
    this.future.push(this.present);
    const prev = this.past.pop()!;
    this.present = prev;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(prev);
  }

  redo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.future.length) return null;
    this.past.push(this.present);
    const next = this.future.pop()!;
    this.present = next;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(next);
  }

  restoreAutosave(current: T): T | null {
    if (!this.initialized) return null;
    const candidate = this.restoreCandidate;
    if (!candidate?.state_json) return null;
    const restored = candidate.state_json;
    this.commitNow(current);
    if (restored === this.present) {
      this.restoreCandidate = null;
      return null;
    }
    this.past.push(this.present);
    this.trimPast();
    this.present = restored;
    this.lastAutosavedAt = candidate.ts;
    this.dirty = this.present !== this.server;
    this.restoreCandidate = null;
    this.writeAutosave(restored, candidate.ts);
    return this.deserialize(restored);
  }

  discardAutosave(): void {
    this.clearAutosave();
    this.restoreCandidate = null;
  }

  dispose(): void {
    this.clearPendingTimer();
  }

  private commitNow(state: T): void {
    const serialized = this.serialize(state);
    this.clearPendingTimer();
    this.pending = null;
    this.autosavePending = false;
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = serialized;
    this.future = [];
    this.writeAutosave(serialized);
  }

  private resetCommitTimer(): void {
    this.clearPendingTimer();
    this.pendingTimer = window.setTimeout(() => this.commitPending(), this.opts.debounceMs);
  }

  private commitPending(): void {
    if (!this.pending) {
      this.autosavePending = false;
      return;
    }
    const next = this.pending;
    this.pending = null;
    this.pendingTimer = null;
    this.autosavePending = false;
    if (next === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = next;
    this.future = [];
    this.dirty = this.present !== this.server;
    this.writeAutosave(next);
  }

  private trimPast(): void {
    if (this.past.length <= this.opts.limit) return;
    this.past.splice(0, this.past.length - this.opts.limit);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private serialize(state: T): string {
    return JSON.stringify(state);
  }

  private deserialize(raw: string): T {
    return JSON.parse(raw) as T;
  }

  private writeAutosave(stateJson: string, tsOverride?: string): void {
    if (typeof window === 'undefined') return;
    const ts = tsOverride || new Date().toISOString();
    this.lastAutosavedAt = ts;
    try {
      const payload: CmsAutosaveEnvelope = { v: 1, ts, state_json: stateJson };
      window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // ignore quota / browser storage errors
    }
  }

  private clearAutosave(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
    this.lastAutosavedAt = null;
  }

  private readAutosaveCandidate(serverStateJson: string): CmsAutosaveEnvelope | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CmsAutosaveEnvelope> | null;
      if (!parsed || parsed.v !== 1) return null;
      const ts = typeof parsed.ts === 'string' ? parsed.ts : '';
      const stateJson = typeof parsed.state_json === 'string' ? parsed.state_json : '';
      if (!ts || !stateJson) return null;
      if (stateJson === serverStateJson) {
        window.localStorage.removeItem(this.storageKey);
        return null;
      }
      return { v: 1, ts, state_json: stateJson };
    } catch {
      return null;
    }
  }
}

@Injectable()
export class AdminCmsStateService {
  readonly cmsHomeDraft = new CmsDraftManager<HomeBlockDraft[]>(
    'adrianaart.cms.autosave.home.sections',
  );
  readonly cmsPageDrafts = new Map<string, CmsDraftManager<PageBlocksDraftState>>();
  readonly cmsBlogDrafts = new Map<string, CmsDraftManager<BlogDraftState>>();

  ensurePageDraft(pageKey: PageBuilderKey): CmsDraftManager<PageBlocksDraftState> {
    const existing = this.cmsPageDrafts.get(pageKey);
    if (existing) return existing;
    const created = new CmsDraftManager<PageBlocksDraftState>(
      `adrianaart.cms.autosave.${pageKey}`,
    );
    this.cmsPageDrafts.set(pageKey, created);
    return created;
  }

  ensureBlogDraft(key: string, lang: UiLang): CmsDraftManager<BlogDraftState> {
    const id = `${key}.${lang}`;
    const existing = this.cmsBlogDrafts.get(id);
    if (existing) return existing;
    const created = new CmsDraftManager<BlogDraftState>(`adrianaart.cms.autosave.${id}`);
    this.cmsBlogDrafts.set(id, created);
    return created;
  }
}
