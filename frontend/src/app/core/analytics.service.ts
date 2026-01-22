import { Injectable } from '@angular/core';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  track(event: string, payload?: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    const record = { event, ...(payload ?? {}) };

    try {
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push(record);
      } else {
        window.dataLayer = [record];
      }
    } catch {
      // ignore
    }

    try {
      window.dispatchEvent(new CustomEvent('app:analytics', { detail: record }));
    } catch {
      // ignore
    }
  }
}

