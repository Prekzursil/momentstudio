import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { ApiService } from './api.service';

export type SiteNavigationLang = 'en' | 'ro';

export interface SiteNavigationLabel {
  en: string;
  ro: string;
}

export interface SiteNavigationLink {
  id: string;
  url: string;
  label: SiteNavigationLabel;
}

export interface SiteNavigationData {
  headerLinks: SiteNavigationLink[];
  footerHandcraftedLinks: SiteNavigationLink[];
  footerLegalLinks: SiteNavigationLink[];
}

interface SiteNavigationMetaV1 {
  version?: number;
  header_links?: unknown;
  footer_handcrafted_links?: unknown;
  footer_legal_links?: unknown;
}

interface ContentBlockRead {
  meta?: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class SiteNavigationService {
  private cached$?: Observable<SiteNavigationData | null>;

  constructor(private api: ApiService) {}

  get(): Observable<SiteNavigationData | null> {
    if (this.cached$) return this.cached$;
    this.cached$ = this.api.get<ContentBlockRead>('/content/site.navigation').pipe(
      map((block) => this.parseBlock(block)),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.cached$;
  }

  resetCache(): void {
    this.cached$ = undefined;
  }

  private parseBlock(block: ContentBlockRead): SiteNavigationData | null {
    const meta = (block.meta ?? {}) as SiteNavigationMetaV1;
    const headerLinks = this.cleanLinks(meta.header_links);
    const footerHandcraftedLinks = this.cleanLinks(meta.footer_handcrafted_links);
    const footerLegalLinks = this.cleanLinks(meta.footer_legal_links);

    if (!headerLinks.length && !footerHandcraftedLinks.length && !footerLegalLinks.length) return null;
    return { headerLinks, footerHandcraftedLinks, footerLegalLinks };
  }

  private cleanLinks(value: unknown): SiteNavigationLink[] {
    if (!Array.isArray(value)) return [];
    const out: SiteNavigationLink[] = [];
    const seen = new Set<string>();

    for (const [idx, raw] of value.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
      const idRaw = typeof rec['id'] === 'string' ? rec['id'].trim() : '';

      const labelRaw = rec['label'];
      const labelRec = labelRaw && typeof labelRaw === 'object' ? (labelRaw as Record<string, unknown>) : {};
      const en = typeof labelRec['en'] === 'string' ? labelRec['en'].trim() : '';
      const ro = typeof labelRec['ro'] === 'string' ? labelRec['ro'].trim() : '';

      if (!url) continue;
      if (!en || !ro) continue;
      const id = idRaw || `nav_${idx + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, url, label: { en, ro } });
    }

    return out;
  }
}

