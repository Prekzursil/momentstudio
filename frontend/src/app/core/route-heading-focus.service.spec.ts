import { NavigationEnd, Router } from '@angular/router';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RouteHeadingFocusService } from './route-heading-focus.service';

describe('RouteHeadingFocusService', () => {
  const routerEvents$ = new Subject<unknown>();

  beforeEach(() => {
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
    routerEvents$.complete();
  });

  it('focuses route heading after navigation end', fakeAsync(() => {
    const heading = document.createElement('h1');
    heading.setAttribute('data-route-heading', 'true');
    heading.tabIndex = -1;
    document.body.appendChild(heading);

    TestBed.inject(RouteHeadingFocusService);

    routerEvents$.next(new NavigationEnd(1, '/shop', '/shop'));
    tick();

    expect(document.activeElement).toBe(heading);
    heading.remove();
  }));
});

