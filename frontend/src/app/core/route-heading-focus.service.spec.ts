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
            events: routerEvents$.asObservable()
          }
        }
      ]
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
});
