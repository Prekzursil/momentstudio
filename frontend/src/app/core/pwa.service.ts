import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PwaService {
  readonly isOnline = signal(true);

  constructor() {
    /* istanbul ignore next -- SSR guard: window is always defined in the browser test environment */
    if (typeof window === 'undefined') return;

    this.isOnline.set(typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true);
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
  }
}
