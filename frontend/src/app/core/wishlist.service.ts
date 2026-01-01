import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Product } from './catalog.service';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly itemsSignal = signal<Product[]>([]);
  readonly items = this.itemsSignal.asReadonly();
  readonly ids = computed(() => new Set(this.itemsSignal().map((p) => p.id)));

  private loaded = false;
  private loading = false;

  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {}

  isLoaded(): boolean {
    return this.loaded;
  }

  ensureLoaded(): void {
    if (this.loaded || this.loading) return;
    if (!this.auth.isAuthenticated()) return;
    this.loading = true;
    this.api.get<Product[]>('/wishlist').subscribe({
      next: (items) => {
        this.itemsSignal.set(items);
        this.loaded = true;
        this.loading = false;
      },
      error: () => {
        this.itemsSignal.set([]);
        this.loaded = true;
        this.loading = false;
      }
    });
  }

  refresh(): void {
    this.loaded = false;
    this.ensureLoaded();
  }

  clear(): void {
    this.itemsSignal.set([]);
    this.loaded = false;
    this.loading = false;
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
  }

  removeLocal(productId: string): void {
    this.itemsSignal.update((items) => items.filter((p) => p.id !== productId));
  }
}
