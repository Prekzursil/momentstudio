import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';

export type AdminFavoriteItemType = 'page' | 'content' | 'order' | 'product' | 'user' | 'filter';

export type AdminFavoriteItem = {
  key: string;
  type: AdminFavoriteItemType;
  label: string;
  subtitle: string;
  url: string;
  state: Record<string, any> | null;
};

type AdminFavoritesResponse = {
  items: AdminFavoriteItem[];
};

@Injectable({ providedIn: 'root' })
export class AdminFavoritesService {
  private initialized = false;
  private readonly maxItems = 50;

  readonly items = signal<AdminFavoriteItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<AdminFavoritesResponse>('/admin/ui/favorites').subscribe({
      next: (res) => {
        const items = Array.isArray(res?.items) ? res.items : [];
        this.items.set(items.slice(0, this.maxItems));
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.t('adminUi.favorites.errors.load'));
        this.loading.set(false);
      }
    });
  }

  isFavorite(key: string): boolean {
    const trimmed = (key || '').trim();
    if (!trimmed) return false;
    return this.items().some((it) => it.key === trimmed);
  }

  toggle(item: AdminFavoriteItem): void {
    if (this.isFavorite(item.key)) {
      this.remove(item.key);
      return;
    }
    this.add(item);
  }

  add(item: AdminFavoriteItem): void {
    const key = (item?.key || '').trim();
    if (!key) return;
    const existing = this.items().filter((it) => it.key !== key);
    const next = [
      {
        key,
        type: item.type,
        label: (item.label || '').trim() || item.url,
        subtitle: (item.subtitle || '').trim(),
        url: (item.url || '').trim() || '/',
        state: item.state && typeof item.state === 'object' ? item.state : null,
      },
      ...existing,
    ].slice(0, this.maxItems);
    this.save(next, existing);
  }

  remove(key: string): void {
    const trimmed = (key || '').trim();
    if (!trimmed) return;
    const prev = this.items();
    const next = prev.filter((it) => it.key !== trimmed);
    this.save(next, prev);
  }

  clear(): void {
    const prev = this.items();
    if (!prev.length) return;
    this.save([], prev);
  }

  private save(next: AdminFavoriteItem[], revertTo: AdminFavoriteItem[]): void {
    this.items.set(next);
    this.loading.set(true);
    this.error.set(null);
    this.api.put<AdminFavoritesResponse>('/admin/ui/favorites', { items: next }).subscribe({
      next: (res) => {
        const items = Array.isArray(res?.items) ? res.items : next;
        this.items.set(items.slice(0, this.maxItems));
        this.loading.set(false);
      },
      error: () => {
        this.items.set(revertTo);
        this.loading.set(false);
        this.toast.error(this.t('adminUi.favorites.errors.save'));
      }
    });
  }

  private t(key: string): string {
    const value = this.translate.instant(key);
    return value === key ? key : value;
  }
}

