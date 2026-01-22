import { Injectable, computed, signal } from '@angular/core';
import { CartApi, CartApiItem } from './cart.api';
import { parseMoney } from '../shared/money';
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
  note?: string | null;
}

export interface CartQuote {
  subtotal: number;
  fee: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

const STORAGE_KEY = 'cart_cache';

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly itemsSignal = signal<CartItem[]>(this.load());
  private readonly quoteSignal = signal<CartQuote>(this.localQuote(this.itemsSignal()));
  private readonly inFlightSignal = signal(0);
  private syncTimeoutId: ReturnType<typeof setTimeout> | null = null;

  readonly items = this.itemsSignal.asReadonly();
  readonly quote = this.quoteSignal.asReadonly();
  readonly syncing = computed(() => this.inFlightSignal() > 0);
  readonly subtotal = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  readonly count = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.quantity, 0)
  );

  constructor(private api: CartApi) {}

  hydrateFromBackend(res: { items: any[]; totals: any }): void {
    const items = this.fromApi(res);
    this.itemsSignal.set(items);
    this.quoteSignal.set(this.quoteFromApi(res));
    this.persist(items);
  }

  loadFromBackend(): void {
    this.inFlightSignal.update((v) => v + 1);
    this.api.get().subscribe({
      next: (res) => {
        const items = this.fromApi(res);
        this.itemsSignal.set(items);
        this.quoteSignal.set(this.quoteFromApi(res));
        this.persist(items);
        this.inFlightSignal.update((v) => Math.max(0, v - 1));
      },
      error: () => {
        // fallback to cached
        this.itemsSignal.set(this.load());
        this.quoteSignal.set(this.localQuote(this.itemsSignal()));
        this.inFlightSignal.update((v) => Math.max(0, v - 1));
      }
    });
  }

  addFromProduct(payload: {
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    name?: string;
    slug?: string;
    image?: string;
    price?: number;
    currency?: string;
    stock?: number;
  }): void {
    this.api
      .addItem({
        product_id: payload.product_id,
        variant_id: payload.variant_id,
        quantity: payload.quantity
      })
      .pipe(
        map((res): CartItem => ({
          id: res.id,
          product_id: res.product_id,
          variant_id: res.variant_id,
          name: res.name ?? payload.name ?? '',
          slug: res.slug ?? payload.slug ?? '',
          price: Number(res.unit_price_at_add ?? payload.price ?? 0),
          currency: res.currency ?? payload.currency ?? 'RON',
          quantity: res.quantity,
          stock: res.max_quantity ?? payload.stock ?? 99,
          image: res.image_url ?? payload.image ?? '',
          note: res.note ?? null
        }))
      )
      .subscribe({
        next: (item) => {
          const current = this.itemsSignal();
          const idx = current.findIndex(
            (i) => i.product_id === item.product_id && i.variant_id === item.variant_id
          );
          const nextItems =
            idx >= 0
              ? current.map((existing, index) =>
                  index === idx ? { ...existing, quantity: existing.quantity + item.quantity } : existing
                )
              : [...current, item];
          this.itemsSignal.set(nextItems);
          this.persist(nextItems);
        },
        error: () => {
          // if backend add fails, keep local state unchanged
        }
      });
  }

  syncBackend(): void {
    this.inFlightSignal.update((v) => v + 1);
    const payload: CartApiItem[] = this.itemsSignal().map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? undefined,
      quantity: i.quantity,
      note: i.note ?? undefined,
      max_quantity: undefined
    }));
    this.api.sync(payload).subscribe({
      next: (res) => {
        const items = this.fromApi(res);
        this.itemsSignal.set(items);
        this.quoteSignal.set(this.quoteFromApi(res));
        this.persist(items);
        this.inFlightSignal.update((v) => Math.max(0, v - 1));
      },
      error: () => {
        // keep local state on failure
        this.inFlightSignal.update((v) => Math.max(0, v - 1));
      }
    });
  }

  updateQuantity(id: string, quantity: number): { errorKey?: string } {
    const items = this.itemsSignal();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { errorKey: 'cart.errors.notFound' };
    if (quantity < 1) return { errorKey: 'cart.errors.minQty' };
    if (quantity > items[idx].stock) return { errorKey: 'cart.errors.insufficientStock' };
    const updated = [...items];
    updated[idx] = { ...updated[idx], quantity };
    this.itemsSignal.set(updated);
    this.persist();
    this.scheduleSyncBackend();
    return {};
  }

  updateNote(id: string, note: string): { errorKey?: string } {
    const trimmed = (note ?? '').trim();
    if (trimmed.length > 255) return { errorKey: 'cart.errors.noteTooLong' };
    const items = this.itemsSignal();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { errorKey: 'cart.errors.notFound' };
    const updated = [...items];
    updated[idx] = { ...updated[idx], note: trimmed || null };
    this.itemsSignal.set(updated);
    this.persist();
    this.scheduleSyncBackend();
    return {};
  }

  remove(id: string): void {
    const item = this.itemsSignal().find((i) => i.id === id);
    if (!item) return;
    this.api.deleteItem(id).subscribe({
      next: () => {
        this.itemsSignal.update((items) => {
          const next = items.filter((i) => i.id !== id);
          this.persist(next);
          return next;
        });
        this.syncBackend();
      },
      error: () => {
        // keep local state unchanged on failure
      }
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
    const currency = res.totals?.currency ?? 'RON';
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
      image: i.image_url ?? '',
      note: i.note ?? null
    }));
  }

  private scheduleSyncBackend(delayMs = 350): void {
    if (this.syncTimeoutId) clearTimeout(this.syncTimeoutId);
    this.syncTimeoutId = setTimeout(() => {
      this.syncTimeoutId = null;
      this.syncBackend();
    }, delayMs);
  }

  private quoteFromApi(res: { totals?: any }): CartQuote {
    const totals = res?.totals ?? {};
    const currency = (totals.currency ?? 'RON') as string;
    return {
      subtotal: parseMoney(totals.subtotal),
      fee: parseMoney(totals.fee),
      tax: parseMoney(totals.tax),
      shipping: parseMoney(totals.shipping),
      total: parseMoney(totals.total),
      currency: currency || 'RON'
    };
  }

  private localQuote(items: CartItem[]): CartQuote {
    const currency = items.find((i) => i.currency)?.currency ?? 'RON';
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return { subtotal, fee: 0, tax: 0, shipping: 0, total: subtotal, currency };
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
