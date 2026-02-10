import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class RouteHeadingFocusService implements OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private readonly document = inject(DOCUMENT);

  constructor(private readonly router: Router) {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroyed$)
      )
      .subscribe(() => this.focusCurrentRouteHeading());
  }

  focusCurrentRouteHeading(): void {
    setTimeout(() => {
      const heading = this.findCurrentRouteHeading();
      if (!heading) return;
      if (!this.document.contains(heading)) return;
      heading.focus();
    }, 0);
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
      this.document.querySelectorAll<HTMLElement>('main [data-route-heading="true"], [role="main"] [data-route-heading="true"]')
    );
    if (fromMain.length) return fromMain;
    return Array.from(this.document.querySelectorAll<HTMLElement>('[data-route-heading="true"]'));
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }
}
