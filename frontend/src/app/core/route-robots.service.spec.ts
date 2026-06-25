import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { RouteRobotsService } from './route-robots.service';

@Component({ standalone: true, template: '<p>Public</p>' })
class PublicComponent {}

@Component({ standalone: true, template: '<p>Private</p>' })
class PrivateComponent {}

describe('RouteRobotsService', () => {
  it('applies noindex on private routes and restores index on public routes', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: '', component: PublicComponent },
          { path: 'blog', component: PublicComponent },
          { path: 'checkout', component: PrivateComponent, data: { robots: 'noindex,nofollow' } },
        ]),
      ],
      providers: [RouteRobotsService],
    });

    const router = TestBed.inject(Router);
    const meta = TestBed.inject(Meta);
    const service = TestBed.inject(RouteRobotsService);

    service.start();
    router.initialNavigation();
    tick();
    expect(meta.getTag("name='robots'")?.content).toBe('index,follow,max-image-preview:large');

    void router.navigateByUrl('/checkout');
    tick();
    expect(meta.getTag("name='robots'")?.content).toBe('noindex,nofollow');

    void router.navigateByUrl('/blog');
    tick();
    expect(meta.getTag("name='robots'")?.content).toBe('index,follow,max-image-preview:large');
  }));

  it('only starts once and unsubscribes on destroy', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([{ path: '', component: PublicComponent }])],
      providers: [RouteRobotsService],
    });
    const router = TestBed.inject(Router);
    const service = TestBed.inject(RouteRobotsService);

    service.start();
    router.initialNavigation();
    tick();
    const sub = (service as unknown as { navSub?: { unsubscribe: () => void } }).navSub;
    expect(sub).toBeDefined();

    // Second start() is a no-op: navSub reference stays the same.
    service.start();
    expect((service as unknown as { navSub?: unknown }).navSub).toBe(sub);

    spyOn(sub!, 'unsubscribe').and.callThrough();
    service.ngOnDestroy();
    expect(sub!.unsubscribe).toHaveBeenCalled();
  }));

  it('handles destroy when start was never called', () => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([])],
      providers: [RouteRobotsService],
    });
    const service = TestBed.inject(RouteRobotsService);
    expect(() => service.ngOnDestroy()).not.toThrow();
  });
});
