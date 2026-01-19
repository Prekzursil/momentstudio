import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LazyStylesService {
  private readonly document = inject(DOCUMENT);
  private readonly inflight = new Map<string, Promise<void>>();

  ensure(id: string, href: string): Promise<void> {
    const existing = this.document.querySelector(`link[data-lazy-style="${id}"]`) as HTMLLinkElement | null;
    if (existing) {
      return Promise.resolve();
    }

    const inflight = this.inflight.get(id);
    if (inflight) {
      return inflight;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const link = this.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset['lazyStyle'] = id;
      link.onload = () => {
        this.inflight.delete(id);
        resolve();
      };
      link.onerror = () => {
        link.remove();
        this.inflight.delete(id);
        reject(new Error(`Failed to load stylesheet: ${href}`));
      };

      this.document.head.appendChild(link);
    });

    this.inflight.set(id, promise);
    return promise;
  }
}

