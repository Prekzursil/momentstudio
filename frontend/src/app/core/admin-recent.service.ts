import { Injectable, signal } from '@angular/core';

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
  private readonly storageKey = 'admin_recent_v1';
  private readonly maxItems = 12;

  readonly items = signal<AdminRecentItem[]>(this.read());

  list(): AdminRecentItem[] {
    return this.items();
  }

  add(item: Omit<AdminRecentItem, 'viewed_at'>): void {
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
    this.write(next);
  }

  clear(): void {
    this.items.set([]);
    this.write([]);
  }

  private read(): AdminRecentItem[] {
    const raw = this.readRaw();
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

  private write(items: AdminRecentItem[]): void {
    const payload = JSON.stringify(items.slice(0, this.maxItems));
    this.writeRaw(payload);
  }

  private readRaw(): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const value = localStorage.getItem(this.storageKey);
      return value ? value : null;
    } catch {
      return null;
    }
  }

  private writeRaw(value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, value);
    } catch {
      // ignore
    }
  }
}

