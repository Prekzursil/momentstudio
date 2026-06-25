import { NavigationEnd, Router } from '@angular/router';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RouteHeadingFocusService } from './route-heading-focus.service';

describe('RouteHeadingFocusService', () => {
  let routerEvents$: Subject<unknown>;

  beforeEach(() => {
    routerEvents$ = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        RouteHeadingFocusService,
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    if (!routerEvents$.closed) {
      routerEvents$.complete();
    }
  });

  it('focuses route heading after navigation end', fakeAsync(() => {
    const shellHeading = document.createElement('h1');
    shellHeading.setAttribute('data-route-heading', 'true');
    shellHeading.tabIndex = -1;
    document.body.appendChild(shellHeading);

    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);

    TestBed.inject(RouteHeadingFocusService);
    const headingFocus = spyOn(heading, 'focus').and.callThrough();
    const shellFocus = spyOn(shellHeading, 'focus').and.callThrough();

    routerEvents$.next(new NavigationEnd(1, '/shop', '/shop'));
    tick();

    expect(headingFocus).toHaveBeenCalled();
    expect(shellFocus).not.toHaveBeenCalled();
    shellHeading.remove();
    main.remove();
  }));

  it('ignores modal headings when focusing route heading', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const modalHeading = document.createElement('h2');
    modalHeading.setAttribute('data-route-heading', 'true');
    modalHeading.tabIndex = -1;
    modal.appendChild(modalHeading);
    document.body.appendChild(modal);

    TestBed.inject(RouteHeadingFocusService);
    const headingFocus = spyOn(heading, 'focus').and.callThrough();
    const modalFocus = spyOn(modalHeading, 'focus').and.callThrough();

    routerEvents$.next(new NavigationEnd(1, '/checkout', '/checkout'));
    tick();

    expect(headingFocus).toHaveBeenCalled();
    expect(modalFocus).not.toHaveBeenCalled();
    heading.remove();
    modal.remove();
  }));

  it('retries until a heading appears', fakeAsync(() => {
    const service = TestBed.inject(RouteHeadingFocusService);
    service.focusCurrentRouteHeading();
    tick(0);

    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();

    tick(75);
    expect(focusSpy).toHaveBeenCalled();
    main.remove();
  }));

  it('gives up after the maximum number of retries when no heading exists', fakeAsync(() => {
    const service = TestBed.inject(RouteHeadingFocusService);
    const retrySpy = spyOn(
      service as unknown as { focusWithRetries: (r: number, i: number) => void },
      'focusWithRetries',
    ).and.callThrough();
    service.focusCurrentRouteHeading();
    tick(75 * 12);
    // Initial call + FOCUS_MAX_RETRIES (10) recursive retries = 11 invocations.
    expect(retrySpy).toHaveBeenCalledTimes(11);
  }));

  it('does not refocus an already-focused heading', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);
    heading.focus();
    expect(document.activeElement).toBe(heading);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();
    service.focusCurrentRouteHeading();
    tick(0);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('skips hidden headings', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    heading.style.display = 'none';
    main.appendChild(heading);
    document.body.appendChild(main);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();
    service.focusCurrentRouteHeading();
    tick(75 * 11);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('clears a pending timer when re-invoked', fakeAsync(() => {
    const service = TestBed.inject(RouteHeadingFocusService);
    service.focusCurrentRouteHeading();
    const firstTimer = service['focusTimer'];
    expect(firstTimer).not.toBeNull();
    service.focusCurrentRouteHeading();
    // Re-invoking must clear the previous timer and schedule a fresh one.
    expect(service['focusTimer']).not.toBe(firstTimer);
    tick(75 * 11);
  }));

  it('cancels an outdated focus run without focusing', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();

    const service = TestBed.inject(RouteHeadingFocusService);
    service.focusCurrentRouteHeading(1);
    service['focusRunId'] = 999;
    tick(75 * 11);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('falls back to any route heading when none are in main', fakeAsync(() => {
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    document.body.appendChild(heading);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();
    service.focusCurrentRouteHeading();
    tick(0);

    expect(focusSpy).toHaveBeenCalled();
    heading.remove();
  }));

  it('skips candidates that are no longer attached to the document', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();
    // The candidate is enumerated but reports as detached during selection.
    spyOn(document, 'contains').and.returnValue(false);
    service.focusCurrentRouteHeading();
    tick(75 * 11);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('skips a modal heading even when it is the only candidate', fakeAsync(() => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    const modalHeading = document.createElement('h1');
    modalHeading.setAttribute('data-route-heading', 'true');
    modalHeading.tabIndex = -1;
    modal.appendChild(modalHeading);
    const main = document.createElement('main');
    main.appendChild(modal);
    document.body.appendChild(main);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(modalHeading, 'focus').and.callThrough();
    service.focusCurrentRouteHeading();
    tick(75 * 11);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('does not focus a heading that left the document before the timer fired', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    main.appendChild(heading);
    document.body.appendChild(main);

    const service = TestBed.inject(RouteHeadingFocusService);
    const focusSpy = spyOn(heading, 'focus').and.callThrough();
    // contains() is consulted once during candidate selection (true), then again
    // at focus time (false) to simulate the heading detaching between the two checks.
    let call = 0;
    spyOn(document, 'contains').and.callFake(() => {
      call += 1;
      return call === 1;
    });
    service.focusCurrentRouteHeading();
    tick(75 * 11);

    expect(focusSpy).not.toHaveBeenCalled();
    main.remove();
  }));

  it('cleans up timers on destroy', fakeAsync(() => {
    const service = TestBed.inject(RouteHeadingFocusService);
    service.focusCurrentRouteHeading();
    expect(service['focusTimer']).not.toBeNull();
    service.ngOnDestroy();
    expect(service['focusTimer']).toBeNull();
    tick(75 * 11);
  }));
});
