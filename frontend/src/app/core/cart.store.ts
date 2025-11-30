import { Injectable, signal, computed } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly itemsSignal = signal<CartItem[]>([
    {
      id: '1',
      name: 'Ocean glaze cup',
      slug: 'ocean-glaze-cup',
      price: 28,
      currency: 'USD',
      quantity: 2,
      stock: 5,
      image: 'https://picsum.photos/seed/ocean/200'
    },
    {
      id: '2',
      name: 'Speckled mug',
      slug: 'speckled-mug',
      price: 24,
      currency: 'USD',
      quantity: 1,
      stock: 2,
      image: 'https://picsum.photos/seed/mug/200'
    }
  ]);

  readonly items = this.itemsSignal.asReadonly();
  readonly subtotal = computed(() =>
    this.itemsSignal().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  updateQuantity(id: string, quantity: number): { error?: string } {
    const items = this.itemsSignal();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { error: 'Item not found' };
    if (quantity < 1) {
      return { error: 'Quantity must be at least 1' };
    }
    if (quantity > items[idx].stock) {
      return { error: 'Not enough stock available' };
    }
    const updated = [...items];
    updated[idx] = { ...updated[idx], quantity };
    this.itemsSignal.set(updated);
    return {};
  }

  remove(id: string): void {
    this.itemsSignal.update((items) => items.filter((i) => i.id !== id));
  }

  clear(): void {
    this.itemsSignal.set([]);
  }
}
