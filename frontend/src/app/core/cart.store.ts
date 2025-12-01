import { Injectable, computed, signal } from '@angular/core';
import { CartApi, CartApiItem } from './cart.api';
import { map } from 'rxjs';

export interface CartItem {
  id: string;
  product_id: string;
  variant_id?: string | null;
  name: string;
  slug: string;
  price: number;
  currency: string;
  quantity: number;
  stock: number;
  image?: string;
}

const STORAGE_KEY = 'cart_cache';

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly itemsSignal = signal<CartItem[]>(this.load());

  readonly items = this.itemsSignal.asReadonly();
  readonly subtotal = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  readonly count = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.quantity, 0)
  );

  constructor(private api: CartApi) {}

  loadFromBackend(): void {
    this.api.get().pipe(map((res) => this.fromApi(res))).subscribe({
      next: (items) => {
        this.itemsSignal.set(items);
        this.persist(items);
      },
      error: () => {
        // fallback to cached
        this.itemsSignal.set(this.load());
      }
    });
  }

  syncBackend(): void {
    const payload: CartApiItem[] = this.itemsSignal().map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? undefined,
      quantity: i.quantity,
      note: undefined,
      max_quantity: undefined
    }));
    this.api.sync(payload).pipe(map((res) => this.fromApi(res))).subscribe({
      next: (items) => {
        this.itemsSignal.set(items);
        this.persist(items);
      },
      error: () => {
        // keep local state on failure
      }
    });
  }

  updateQuantity(id: string, quantity: number): { error?: string } {
    const items = this.itemsSignal();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { error: 'Item not found' };
    if (quantity < 1) return { error: 'Quantity must be at least 1' };
    if (quantity > items[idx].stock) return { error: 'Not enough stock available' };
    const updated = [...items];
    updated[idx] = { ...updated[idx], quantity };
    this.itemsSignal.set(updated);
    this.persist();
    this.syncBackend();
    return {};
  }

  remove(id: string): void {
    this.itemsSignal.update((items) => {
      const next = items.filter((i) => i.id !== id);
      this.persist(next);
      this.syncBackend();
      return next;
    });
  }

  clear(): void {
    this.itemsSignal.set([]);
    this.persist([]);
    this.syncBackend();
  }

  seed(items: CartItem[]): void {
    this.itemsSignal.set(items);
    this.persist(items);
    this.syncBackend();
  }

  private fromApi(res: { items: any[]; totals: any }): CartItem[] {
    const currency = res.totals?.currency ?? 'USD';
    return res.items.map((i) => ({
      id: i.id,
      product_id: i.product_id,
      variant_id: i.variant_id,
      name: i.name ?? '',
      slug: i.slug ?? '',
      price: Number(i.unit_price_at_add),
      currency: i.currency ?? currency,
      quantity: i.quantity,
      stock: i.max_quantity ?? 99,
      image: i.image_url ?? ''
    }));
  }

  private persist(next?: CartItem[]): void {
    const payload = (next ?? this.itemsSignal()).map((i) => ({ ...i }));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
  }

  private load(): CartItem[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as CartItem[];
    } catch {
      return [];
    }
  }
}
