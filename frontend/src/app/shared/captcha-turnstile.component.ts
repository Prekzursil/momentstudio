import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    if (window.turnstile) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-turnstile="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset['turnstile'] = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Turnstile')), { once: true });
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

@Component({
  selector: 'app-captcha-turnstile',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-2">
      <div #host></div>
      <p *ngIf="errorKey" class="text-xs text-rose-700 dark:text-rose-300">{{ errorKey | translate }}</p>
    </div>
  `
})
export class CaptchaTurnstileComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) siteKey!: string;
  @Input() theme: 'auto' | 'light' | 'dark' = 'auto';
  @Output() tokenChange = new EventEmitter<string | null>();
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  errorKey: string | null = null;
  private widgetId: string | null = null;

  ngAfterViewInit(): void {
    void this.initTurnstile();
  }

  private async initTurnstile(): Promise<void> {
    if (!this.siteKey) return;

    try {
      await loadTurnstileScript();
      const api = window.turnstile;
      if (!api) {
        this.errorKey = 'auth.captchaUnavailable';
        return;
      }
      const hostEl = this.host.nativeElement;
      hostEl.innerHTML = '';
      this.widgetId = api.render(hostEl, {
        sitekey: this.siteKey,
        theme: this.theme,
        callback: (token: string) => this.tokenChange.emit(token),
        'expired-callback': () => this.tokenChange.emit(null),
        'error-callback': () => {
          this.errorKey = 'auth.captchaFailedTryAgain';
          this.tokenChange.emit(null);
        }
      });
    } catch {
      this.errorKey = 'auth.captchaFailedLoad';
    }
  }
  reset(): void {
    if (!this.widgetId) return;
    window.turnstile?.reset(this.widgetId);
    this.tokenChange.emit(null);
  }
  ngOnDestroy(): void {
    if (this.widgetId) {
      window.turnstile?.remove(this.widgetId);
      this.widgetId = null;
    }
  }
}
