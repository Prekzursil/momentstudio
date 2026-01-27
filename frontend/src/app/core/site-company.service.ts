import { Injectable } from '@angular/core';
import { Observable, of, shareReplay, map, catchError } from 'rxjs';

import { ApiService } from './api.service';

export interface SiteCompanyInfo {
  name: string | null;
  registrationNumber: string | null;
  cui: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface SiteCompanyInfoMetaV1 {
  version?: number;
  company?: {
    name?: string | null;
    registration_number?: string | null;
    cui?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
}

const EMPTY_COMPANY: SiteCompanyInfo = {
  name: null,
  registrationNumber: null,
  cui: null,
  address: null,
  phone: null,
  email: null
};

interface ContentBlockRead {
  meta?: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class SiteCompanyService {
  private cached$?: Observable<SiteCompanyInfo>;

  constructor(private api: ApiService) {}

  get(): Observable<SiteCompanyInfo> {
    if (this.cached$) return this.cached$;
    this.cached$ = this.api.get<ContentBlockRead>('/content/site.company').pipe(
      map((block) => this.parseBlock(block)),
      catchError(() => of(EMPTY_COMPANY)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.cached$;
  }

  resetCache(): void {
    this.cached$ = undefined;
  }

  private parseBlock(block: ContentBlockRead): SiteCompanyInfo {
    const meta = (block.meta ?? {}) as SiteCompanyInfoMetaV1;
    const company = meta.company ?? {};
    const name = this.clean(company.name);
    const registrationNumber = this.clean(company.registration_number);
    const cui = this.clean(company.cui);
    const address = this.clean(company.address);
    const phone = this.clean(company.phone);
    const email = this.clean(company.email);
    return {
      name,
      registrationNumber,
      cui,
      address,
      phone,
      email
    };
  }

  private clean(value: unknown): string | null {
    if (typeof value === 'string') {
      const cleaned = value.trim();
      return cleaned ? cleaned : null;
    }
    if (typeof value === 'number') {
      const cleaned = String(value).trim();
      return cleaned ? cleaned : null;
    }
    return null;
  }
}
