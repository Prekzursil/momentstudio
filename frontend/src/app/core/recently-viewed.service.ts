import { Injectable } from '@angular/core';
import { Product } from './catalog.service';

export type RecentlyViewedProduct = Pick<Product, 'id' | 'slug' | 'name' | 'base_price' | 'currency' | 'images'>;

@Injectable({ providedIn: 'root' })
export class RecentlyViewedService {
  private readonly storageKey = 'recently_viewed';
  private readonly maxItems = 12;

  list(): RecentlyViewedProduct[] {
    return this.read();
  }

  add(product: Product): RecentlyViewedProduct[] {
    const existing = this.read();
    const filtered = existing.filter((item) => item.slug !== product.slug);
    const next: RecentlyViewedProduct[] = [
      {
        id: product.id,
        slug: product.slug,
        name: product.name,
        base_price: product.base_price,
        currency: product.currency,
        images: product.images
      },
      ...filtered
    ];
    this.write(next.slice(0, this.maxItems));
    return next;
  }

  private read(): RecentlyViewedProduct[] {
    const raw = this.readRaw();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as RecentlyViewedProduct[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.slug === 'string');
    } catch {
      return [];
    }
  }

  private write(items: RecentlyViewedProduct[]): void {
    const payload = JSON.stringify(items.slice(0, this.maxItems));
    this.writeRaw(payload);
  }

  private readRaw(): string | null {
    if (typeof localStorage !== 'undefined') {
      try {
        const value = localStorage.getItem(this.storageKey);
        if (value) return value;
      } catch {
        // fall through to cookie
      }
    }
    return this.readCookie(this.storageKey);
  }

  private writeRaw(value: string): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, value);
      } catch {
      }
    }
    this.writeCookie(this.storageKey, value, 30);
  }

  private readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const prefix = `${name}=`;
    const cookies = document.cookie ? document.cookie.split(';') : [];
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  }

  private writeCookie(name: string, value: string, days: number): void {
    if (typeof document === 'undefined') return;
    const expires = new Date();
    expires.setDate(expires.getDate() + days);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
  }
}
