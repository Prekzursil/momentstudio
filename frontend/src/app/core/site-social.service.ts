import { Injectable } from '@angular/core';
import { Observable, of, shareReplay, map, catchError } from 'rxjs';

import { ApiService } from './api.service';

export interface SiteSocialLink {
  label: string;
  url: string;
  thumbnail_url?: string | null;
}

export interface SiteSocialContact {
  phone?: string | null;
  email?: string | null;
}

export interface SiteSocialMetaV1 {
  version?: number;
  contact?: SiteSocialContact;
  instagram_pages?: SiteSocialLink[];
  facebook_pages?: SiteSocialLink[];
}

export interface SiteSocialData {
  contact: SiteSocialContact;
  instagramPages: SiteSocialLink[];
  facebookPages: SiteSocialLink[];
}

const DEFAULT_SOCIAL: SiteSocialData = {
  contact: { phone: '+40723204204', email: 'momentstudio.ro@gmail.com' },
  instagramPages: [
    { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx' },
    { label: 'adrianaartizanat', url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy' }
  ],
  facebookPages: [
    { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/share/17YqBmfX5x/' },
    { label: 'adrianaartizanat', url: 'https://www.facebook.com/share/1APqKJM6Zi/' }
  ]
};

interface ContentBlockRead {
  meta?: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class SiteSocialService {
  private cached$?: Observable<SiteSocialData>;

  constructor(private api: ApiService) {}

  get(): Observable<SiteSocialData> {
    if (this.cached$) return this.cached$;
    this.cached$ = this.api.get<ContentBlockRead>('/content/site.social').pipe(
      map((block) => this.parseBlock(block)),
      catchError(() => of(DEFAULT_SOCIAL)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.cached$;
  }

  resetCache(): void {
    this.cached$ = undefined;
  }

  private parseBlock(block: ContentBlockRead): SiteSocialData {
    const meta = (block.meta ?? {}) as SiteSocialMetaV1;
    const instagramPages = this.cleanLinks(meta.instagram_pages) ?? DEFAULT_SOCIAL.instagramPages;
    const facebookPages = this.cleanLinks(meta.facebook_pages) ?? DEFAULT_SOCIAL.facebookPages;
    const contact = this.cleanContact(meta.contact) ?? DEFAULT_SOCIAL.contact;
    return { instagramPages, facebookPages, contact };
  }

  private cleanLinks(value: unknown): SiteSocialLink[] | null {
    if (!Array.isArray(value)) return null;
    const items: SiteSocialLink[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const label = String((raw as any).label ?? '').trim();
      const url = String((raw as any).url ?? '').trim();
      const thumbnail_url = (raw as any).thumbnail_url;
      const thumb = typeof thumbnail_url === 'string' ? thumbnail_url.trim() : null;
      if (!label || !url) continue;
      items.push({ label, url, thumbnail_url: thumb || null });
    }
    return items.length ? items : null;
  }

  private cleanContact(value: unknown): SiteSocialContact | null {
    if (!value || typeof value !== 'object') return null;
    const phone = String((value as any).phone ?? '').trim();
    const email = String((value as any).email ?? '').trim();
    if (!phone && !email) return null;
    return { phone: phone || null, email: email || null };
  }
}
