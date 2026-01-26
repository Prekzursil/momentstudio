import { EffectRef, Injectable, effect, signal } from '@angular/core';
import { AuthService } from './auth.service';

export type AdminRecentItemType = 'page' | 'order' | 'product' | 'user' | 'content';

export type AdminRecentItem = {
  key: string;
  type: AdminRecentItemType;
  label: string;
  subtitle: string;
  url: string;
  state: Record<string, any> | null;
  viewed_at: string;
};

@Injectable({ providedIn: 'root' })
export class AdminRecentService {
  private readonly storageKeyBase = 'admin_recent_v1';
  private readonly maxItems = 12;
  private authEffect?: EffectRef;
  private activeUserId: string | null = null;
  private pending: AdminRecentItem[] = [];

  readonly items = signal<AdminRecentItem[]>([]);

  constructor(private auth: AuthService) {
    this.authEffect = effect(() => {
      const userId = this.auth.user()?.id ?? null;
      if (userId === this.activeUserId) return;
      this.activeUserId = userId;
      if (!userId) {
        this.pending = [];
        this.items.set([]);
        return;
      }
      const loaded = this.read(userId);
      const merged = this.merge(loaded, this.pending);
      this.pending = [];
      this.items.set(merged);
      this.write(userId, merged);
    });
  }

  list(): AdminRecentItem[] {
    return this.items();
  }

  add(item: Omit<AdminRecentItem, 'viewed_at'>): void {
    const userId = this.auth.user()?.id ?? null;
    const now = new Date().toISOString();
    const entry: AdminRecentItem = {
      key: (item.key || '').slice(0, 128),
      type: item.type,
      label: (item.label || '').slice(0, 180) || item.url,
      subtitle: (item.subtitle || '').slice(0, 240),
      url: (item.url || '').slice(0, 500) || '/',
      state: item.state && typeof item.state === 'object' ? item.state : null,
      viewed_at: now
    };
    if (!entry.key) return;

    const existing = this.items().filter((it) => it.key !== entry.key);
    const next = [entry, ...existing].slice(0, this.maxItems);
    this.items.set(next);
    if (userId) {
      this.write(userId, next);
    } else {
      this.pending = next;
    }
  }

  clear(): void {
    const userId = this.auth.user()?.id ?? null;
    this.items.set([]);
    if (userId) {
      this.write(userId, []);
    } else {
      this.pending = [];
    }
  }

  private merge(existing: AdminRecentItem[], pending: AdminRecentItem[]): AdminRecentItem[] {
    if (!pending.length) return existing.slice(0, this.maxItems);
    const seen = new Set<string>();
    const merged = [...pending, ...existing].filter((item) => {
      if (!item?.key) return false;
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
    return merged.slice(0, this.maxItems);
  }

  private read(userId: string): AdminRecentItem[] {
    const raw = this.readRaw(userId);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as AdminRecentItem[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item.key === 'string' &&
            typeof item.type === 'string' &&
            typeof item.label === 'string' &&
            typeof item.url === 'string'
        )
        .slice(0, this.maxItems);
    } catch {
      return [];
    }
  }

  private write(userId: string, items: AdminRecentItem[]): void {
    const payload = JSON.stringify(items.slice(0, this.maxItems));
    this.writeRaw(userId, payload);
  }

  private storageKey(userId: string): string {
    return `${this.storageKeyBase}:${userId}`;
  }

  private readRaw(userId: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const value = localStorage.getItem(this.storageKey(userId));
      return value ? value : null;
    } catch {
      return null;
    }
  }

  private writeRaw(userId: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey(userId), value);
    } catch {
      // ignore
    }
  }
}
