import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';

const FOCUS_RETRY_DELAY_MS = 75;
const FOCUS_MAX_RETRIES = 10;

@Injectable({ providedIn: 'root' })
export class RouteHeadingFocusService implements OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private readonly document = inject(DOCUMENT);
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly router: Router) {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroyed$)
      )
      .subscribe(() => this.focusCurrentRouteHeading());
  }

  focusCurrentRouteHeading(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.focusWithRetries(0);
  }

  private focusWithRetries(retryIndex: number): void {
    this.focusTimer = setTimeout(() => {
      const heading = this.findCurrentRouteHeading();
      if (!heading) {
        if (retryIndex < FOCUS_MAX_RETRIES) {
          this.focusWithRetries(retryIndex + 1);
        }
        return;
      }
      if (!this.document.contains(heading)) return;
      this.focusTimer = null;
      heading.focus();
    }, retryIndex === 0 ? 0 : FOCUS_RETRY_DELAY_MS);
  }

  private findCurrentRouteHeading(): HTMLElement | null {
    const markers = this.collectCandidates();
    if (!markers.length) return null;

    for (let idx = markers.length - 1; idx >= 0; idx -= 1) {
      const candidate = markers[idx];
      if (!this.document.contains(candidate)) continue;
      if (candidate.closest('[aria-modal="true"]')) continue;
      const style = this.document.defaultView?.getComputedStyle(candidate);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
      return candidate;
    }
    return null;
  }

  private collectCandidates(): HTMLElement[] {
    const fromMain = Array.from(
      this.document.querySelectorAll<HTMLElement>(
        '#main-content [data-route-heading="true"], main [data-route-heading="true"], [role="main"] [data-route-heading="true"]'
      )
    );
    if (fromMain.length) return fromMain;
    return Array.from(this.document.querySelectorAll<HTMLElement>('[data-route-heading="true"]'));
  }

  ngOnDestroy(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.destroyed$.next();
    this.destroyed$.complete();
  }
}
