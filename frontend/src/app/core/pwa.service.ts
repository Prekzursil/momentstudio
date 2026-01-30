import { Injectable, signal } from '@angular/core';

type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class PwaService {
  private installPrompt: any | null = null;

  readonly canInstall = signal(false);
  readonly isInstalled = signal(false);
  readonly isOnline = signal(true);

  constructor() {
    if (typeof window === 'undefined') return;

    this.isOnline.set(typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true);
    this.isInstalled.set(this.detectInstalled());

    window.addEventListener('beforeinstallprompt', (event: any) => {
      event.preventDefault();
      this.installPrompt = event;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
    });

    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
  }

  async promptInstall(): Promise<InstallPromptOutcome> {
    const event = this.installPrompt;
    if (!event || typeof event.prompt !== 'function') return 'unavailable';
    try {
      await event.prompt();
      const choice = await event.userChoice;
      this.installPrompt = null;
      this.canInstall.set(false);
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      this.installPrompt = null;
      this.canInstall.set(false);
      return 'dismissed';
    }
  }

  private detectInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    const displayStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
    const iosStandalone = (navigator as any)?.standalone === true;
    return Boolean(displayStandalone || iosStandalone);
  }
}

