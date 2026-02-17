import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

export type SeoLanguage = 'en' | 'ro';

type SeoQueryValue = string | number | undefined;

@Injectable({ providedIn: 'root' })
export class SeoHeadLinksService {
  private readonly document = inject(DOCUMENT);
  private readonly managedAlternateSelector = 'link[rel="alternate"][data-seo-managed="true"]';

  setLocalizedCanonical(path: string, currentLang: SeoLanguage, query: Record<string, SeoQueryValue> = {}): string {
    const lang = currentLang === 'ro' ? 'ro' : 'en';
    const langAgnosticQuery = this.withoutLang(query);
    const canonicalEn = this.buildHref(path, langAgnosticQuery);
    const canonicalRo = this.buildHref(path, { ...langAgnosticQuery, lang: 'ro' });
    const canonicalHref = lang === 'ro' ? canonicalRo : canonicalEn;
    this.upsertCanonical(canonicalHref);

    this.clearManagedAlternates();
    this.upsertAlternate('en', canonicalEn);
    this.upsertAlternate('ro', canonicalRo);
    this.upsertAlternate('x-default', canonicalEn);

    return canonicalHref;
  }

  clearManagedAlternates(): void {
    this.document.querySelectorAll<HTMLLinkElement>(this.managedAlternateSelector).forEach((node) => node.remove());
  }

  private upsertCanonical(href: string): void {
    const existing = Array.from(this.document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'));
    let link = existing[0] ?? null;
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    existing.slice(1).forEach((node) => node.remove());
    link.setAttribute('href', href);
  }

  private upsertAlternate(hreflang: 'en' | 'ro' | 'x-default', href: string): void {
    const link = this.document.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', hreflang);
    link.setAttribute('href', href);
    link.setAttribute('data-seo-managed', 'true');
    this.document.head.appendChild(link);
  }

  private buildHref(path: string, query: Record<string, SeoQueryValue>): string {
    const origin = this.currentOrigin();
    const normalizedPath = this.normalizePath(path);
    const qs = this.toSearchParams(query).toString();
    return qs ? `${origin}${normalizedPath}?${qs}` : `${origin}${normalizedPath}`;
  }

  private currentOrigin(): string {
    const fromDocument = this.document.defaultView?.location?.origin;
    if (fromDocument) return fromDocument;
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return 'https://momentstudio.ro';
  }

  private normalizePath(path: string): string {
    const trimmed = String(path || '').trim();
    if (!trimmed) return '/';
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  private withoutLang(query: Record<string, SeoQueryValue>): Record<string, SeoQueryValue> {
    const out: Record<string, SeoQueryValue> = {};
    for (const [key, value] of Object.entries(query || {})) {
      if (key === 'lang') continue;
      out[key] = value;
    }
    return out;
  }

  private toSearchParams(query: Record<string, SeoQueryValue>): URLSearchParams {
    const params = new URLSearchParams();
    const keys = Object.keys(query).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const value = query[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) continue;
        params.set(key, String(value));
        continue;
      }
      const text = String(value).trim();
      if (!text.length) continue;
      params.set(key, text);
    }
    return params;
  }
}
