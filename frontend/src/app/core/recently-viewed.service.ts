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
        currency: product.currency || 'RON',
        images: Array.isArray(product.images) ? product.images : []
      },
      ...filtered
    ];
    const sliced = next.slice(0, this.maxItems);
    this.write(sliced);
    return sliced;
  }

  private read(): RecentlyViewedProduct[] {
    const raw = this.readRaw();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const normalized = this.normalize(parsed).slice(0, this.maxItems);
      const nextRaw = JSON.stringify(normalized);
      if (nextRaw !== raw) {
        this.writeRaw(nextRaw);
      }
      return normalized;
    } catch {
      return [];
    }
  }

  private normalize(items: unknown[]): RecentlyViewedProduct[] {
    const normalized: RecentlyViewedProduct[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item: any = raw;
      const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
      if (!slug) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);

      const id = typeof item.id === 'string' && item.id.trim() ? item.id : slug;
      const name = typeof item.name === 'string' ? item.name : '';
      const basePriceRaw = Number(item.base_price);
      const base_price = Number.isFinite(basePriceRaw) ? basePriceRaw : 0;
      const currencyRaw = typeof item.currency === 'string' ? item.currency.trim() : '';
      const currency = currencyRaw || 'RON';
      const images = Array.isArray(item.images) ? item.images.filter((img: any) => img && typeof img.url === 'string') : [];

      normalized.push({ id, slug, name, base_price, currency, images });
    }
    return normalized;
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
        // ignore localStorage write failures and fall back to cookie
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
