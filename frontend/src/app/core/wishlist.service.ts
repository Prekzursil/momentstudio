import { EffectRef, Injectable, computed, effect, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Product } from './catalog.service';

export interface WishlistSnapshotEntry {
  saved_at: string;
  price: number;
  stock_quantity: number | null;
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly itemsSignal = signal<Product[]>([]);
  readonly items = this.itemsSignal.asReadonly();
  readonly ids = computed(() => new Set(this.itemsSignal().map((p) => p.id)));
  private readonly snapshotSignal = signal<Record<string, WishlistSnapshotEntry>>({});
  readonly snapshots = this.snapshotSignal.asReadonly();

  private readonly loadedSignal = signal(false);
  private readonly loadingSignal = signal(false);
  private authEffect?: EffectRef;
  private activeUserId: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {
    this.authEffect = effect(() => {
      const userId = this.auth.user()?.id ?? null;
      if (userId === this.activeUserId) return;
      this.activeUserId = userId;
      this.clear();
      this.snapshotSignal.set(userId ? this.loadSnapshots(userId) : {});
      if (userId) {
        this.ensureLoaded();
      }
    });
  }

  isLoaded(): boolean {
    return this.loadedSignal();
  }

  ensureLoaded(): void {
    if (this.loadedSignal() || this.loadingSignal()) return;
    if (!this.auth.isAuthenticated()) return;
    this.loadingSignal.set(true);
    this.api.get<Product[]>('/wishlist').subscribe({
      next: (items) => {
        this.itemsSignal.set(items);
        this.ensureBaselines(items);
        this.loadedSignal.set(true);
        this.loadingSignal.set(false);
      },
      error: () => {
        this.itemsSignal.set([]);
        this.loadedSignal.set(false);
        this.loadingSignal.set(false);
      }
    });
  }

  refresh(): void {
    this.loadedSignal.set(false);
    this.ensureLoaded();
  }

  clear(): void {
    this.itemsSignal.set([]);
    this.loadedSignal.set(false);
    this.loadingSignal.set(false);
  }

  isWishlisted(productId: string): boolean {
    return this.ids().has(productId);
  }

  add(productId: string): Observable<Product> {
    return this.api.post<Product>(`/wishlist/${productId}`, {});
  }

  remove(productId: string): Observable<void> {
    return this.api.delete<void>(`/wishlist/${productId}`);
  }

  addLocal(product: Product): void {
    this.itemsSignal.update((items) => {
      if (items.some((p) => p.id === product.id)) return items;
      return [...items, product];
    });
    this.upsertBaseline(product);
  }

  removeLocal(productId: string): void {
    this.itemsSignal.update((items) => items.filter((p) => p.id !== productId));
    this.deleteBaseline(productId);
  }

  getBaseline(productId: string): WishlistSnapshotEntry | null {
    return this.snapshotSignal()[productId] ?? null;
  }

  effectivePrice(product: Product): number {
    const sale = product.sale_price;
    if (typeof sale === 'number' && Number.isFinite(sale) && sale < product.base_price) return sale;
    return product.base_price;
  }

  private snapshotStorageKey(userId: string): string {
    return `wishlist_snapshot:${userId}`;
  }

  private loadSnapshots(userId: string): Record<string, WishlistSnapshotEntry> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(this.snapshotStorageKey(userId));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, WishlistSnapshotEntry>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistSnapshots(next: Record<string, WishlistSnapshotEntry>): void {
    if (typeof localStorage === 'undefined') return;
    const userId = this.activeUserId;
    if (!userId) return;
    try {
      localStorage.setItem(this.snapshotStorageKey(userId), JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  }

  private ensureBaselines(items: Product[]): void {
    const userId = this.activeUserId;
    if (!userId) return;

    const current = this.snapshotSignal();
    let changed = false;
    const now = new Date().toISOString();
    const next = { ...current };

    for (const product of items) {
      if (!product?.id) continue;
      if (next[product.id]) continue;
      next[product.id] = {
        saved_at: now,
        price: this.effectivePrice(product),
        stock_quantity: product.stock_quantity ?? null
      };
      changed = true;
    }

    if (changed) {
      this.snapshotSignal.set(next);
      this.persistSnapshots(next);
    }
  }

  private upsertBaseline(product: Product): void {
    const userId = this.activeUserId;
    if (!userId || !product?.id) return;
    const current = this.snapshotSignal();
    if (current[product.id]) return;
    const next = {
      ...current,
      [product.id]: {
        saved_at: new Date().toISOString(),
        price: this.effectivePrice(product),
        stock_quantity: product.stock_quantity ?? null
      }
    };
    this.snapshotSignal.set(next);
    this.persistSnapshots(next);
  }

  private deleteBaseline(productId: string): void {
    const userId = this.activeUserId;
    if (!userId) return;
    const current = this.snapshotSignal();
    if (!(productId in current)) return;
    const next = { ...current };
    delete next[productId];
    this.snapshotSignal.set(next);
    this.persistSnapshots(next);
  }
}
