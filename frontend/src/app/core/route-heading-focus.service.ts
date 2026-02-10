import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class RouteHeadingFocusService implements OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private readonly document = inject(DOCUMENT);

  constructor(
    private readonly router: Router,
    private readonly zone: NgZone
  ) {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroyed$)
      )
      .subscribe(() => this.focusCurrentRouteHeading());
  }

  focusCurrentRouteHeading(): void {
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        const heading = this.document.querySelector<HTMLElement>('[data-route-heading="true"]');
        if (!heading) return;
        if (!this.document.contains(heading)) return;
        heading.focus();
      }, 0);
    });
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }
}
