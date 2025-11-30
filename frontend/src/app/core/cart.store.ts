import { Injectable, computed, signal } from '@angular/core';

export interface CartItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  quantity: number;
  stock: number;
  image?: string;
}

const STORAGE_KEY = 'cart_items';

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly itemsSignal = signal<CartItem[]>(this.load());

  readonly items = this.itemsSignal.asReadonly();
  readonly subtotal = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

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
    return {};
  }

  remove(id: string): void {
    this.itemsSignal.update((items) => {
      const next = items.filter((i) => i.id !== id);
      this.persist(next);
      return next;
    });
  }

  clear(): void {
    this.itemsSignal.set([]);
    this.persist([]);
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
