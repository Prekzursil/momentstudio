import { NavigationEnd, Router } from '@angular/router';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RouteHeadingFocusService } from './route-heading-focus.service';

let routeHeadingRouterEvents$: Subject<unknown>;

describe('RouteHeadingFocusService', () => {
  beforeEach(() => {
    routeHeadingRouterEvents$ = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        RouteHeadingFocusService,
        {
          provide: Router,
          useValue: {
            events: routeHeadingRouterEvents$.asObservable()
          }
        }
      ]
    });
  });

  afterEach(() => {
    if (!routeHeadingRouterEvents$.closed) {
      routeHeadingRouterEvents$.complete();
    }
  });

  defineRouteHeadingFocusSpec();
  defineModalHeadingIgnoreSpec();
});

const defineRouteHeadingFocusSpec = (): void => {
  it('focuses route heading after navigation end', fakeAsync(() => {
    const shellHeading = createRouteHeadingElement('h1');
    document.body.appendChild(shellHeading);
    const main = document.createElement('main');
    const heading = createRouteHeadingElement('h1');
    main.appendChild(heading);
    document.body.appendChild(main);

    TestBed.inject(RouteHeadingFocusService);
    const headingFocus = spyOn(heading, 'focus').and.callThrough();
    const shellFocus = spyOn(shellHeading, 'focus').and.callThrough();
    routeHeadingRouterEvents$.next(new NavigationEnd(1, '/shop', '/shop'));
    tick();

    expect(headingFocus).toHaveBeenCalled();
    expect(shellFocus).not.toHaveBeenCalled();
    shellHeading.remove();
    main.remove();
  }));
};

const defineModalHeadingIgnoreSpec = (): void => {
  it('ignores modal headings when focusing route heading', fakeAsync(() => {
    const main = document.createElement('main');
    const heading = createRouteHeadingElement('h1');
    main.appendChild(heading);
    document.body.appendChild(main);

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const modalHeading = createRouteHeadingElement('h2');
    modal.appendChild(modalHeading);
    document.body.appendChild(modal);

    TestBed.inject(RouteHeadingFocusService);
    const headingFocus = spyOn(heading, 'focus').and.callThrough();
    const modalFocus = spyOn(modalHeading, 'focus').and.callThrough();
    routeHeadingRouterEvents$.next(new NavigationEnd(1, '/checkout', '/checkout'));
    tick();

    expect(headingFocus).toHaveBeenCalled();
    expect(modalFocus).not.toHaveBeenCalled();
    heading.remove();
    modal.remove();
  }));
};

const createRouteHeadingElement = (tagName: 'h1' | 'h2'): HTMLElement => {
  const element = document.createElement(tagName);
  element.dataset['routeHeading'] = 'true';
  element.tabIndex = -1;
  return element;
};
