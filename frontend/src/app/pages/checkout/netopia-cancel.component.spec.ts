import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CartStore } from '../../core/cart.store';
import { NetopiaCancelComponent } from './netopia-cancel.component';

const PENDING_KEY = 'checkout_netopia_pending';

describe('NetopiaCancelComponent', () => {
  let apiService: jasmine.SpyObj<ApiService>;
  let cart: jasmine.SpyObj<CartStore>;
  let router: Router;
  let postResult: any;

  beforeEach(() => {
    // Default API response: an immediate, successful confirmation.
    postResult = of({ order_id: 'o1', reference_code: 'REF', status: 'confirmed' });
  });

  function configure(queryParams: Record<string, string> = {}): void {
    apiService = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    apiService.post.and.callFake(() => postResult);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['clear']);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, NetopiaCancelComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: apiService },
        { provide: CartStore, useValue: cart },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(queryParams) },
          },
        },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
  }

  function create(): ComponentFixture<NetopiaCancelComponent> {
    return TestBed.createComponent(NetopiaCancelComponent);
  }

  it('removes the pending checkout flag from localStorage on construction', () => {
    const removeSpy = spyOn(localStorage, 'removeItem').and.callThrough();
    configure({});

    create();

    expect(removeSpy).toHaveBeenCalledWith(PENDING_KEY);
  });

  it('ignores errors thrown while clearing the pending flag', () => {
    spyOn(localStorage, 'removeItem').and.throwError('quota');
    configure({});

    // The swallowed try/catch must not let the constructor error propagate.
    expect(() => create()).not.toThrow();
  });

  it('skips localStorage access entirely when it is undefined', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => undefined,
    });
    try {
      configure({});
      const fixture = create();
      expect(fixture.componentInstance).toBeTruthy();
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      } else {
        delete (window as { localStorage?: Storage }).localStorage;
      }
    }
  });

  it('does not confirm payment and shows the cancelled card when no order_id is present', () => {
    configure({});
    const fixture = create();
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    expect(cmp.checking).toBeFalse();
    expect(apiService.post).not.toHaveBeenCalled();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('checkout.netopiaCancelled');
    expect(text).not.toContain('checkout.netopiaConfirming');
  });

  it('confirms payment with the ntp_id key, clears the cart, and redirects to success', fakeAsync(() => {
    configure({ order_id: 'order-42', ntp_id: 'ntp-A' });
    const fixture = create();
    fixture.detectChanges();
    tick();

    expect(apiService.post).toHaveBeenCalledWith('/orders/netopia/confirm', {
      order_id: 'order-42',
      ntp_id: 'ntp-A',
    });
    expect(cart.clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
    expect(fixture.componentInstance.checking).toBeFalse();
  }));

  it('falls back to the ntpID query key', fakeAsync(() => {
    configure({ order_id: 'order-1', ntpID: 'ntp-B' });
    create().detectChanges();
    tick();

    const payload = apiService.post.calls.mostRecent().args[1] as { ntp_id?: string };
    expect(payload.ntp_id).toBe('ntp-B');
  }));

  it('falls back to the ntpId query key', fakeAsync(() => {
    configure({ order_id: 'order-1', ntpId: 'ntp-C' });
    create().detectChanges();
    tick();

    const payload = apiService.post.calls.mostRecent().args[1] as { ntp_id?: string };
    expect(payload.ntp_id).toBe('ntp-C');
  }));

  it('omits ntp_id from the payload when no netopia id is present', fakeAsync(() => {
    configure({ order_id: 'order-1' });
    create().detectChanges();
    tick();

    const payload = apiService.post.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(payload).toEqual({ order_id: 'order-1' });
    expect('ntp_id' in payload).toBeFalse();
  }));

  it('shows the confirming card while the request is in flight', fakeAsync(() => {
    postResult = new Subject<unknown>();
    configure({ order_id: 'order-1' });
    const fixture = create();
    fixture.detectChanges();

    expect(fixture.componentInstance.checking).toBeTrue();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('checkout.netopiaConfirming');

    // Tear down the pending subscription so the timeout timer is cleared.
    fixture.componentInstance.ngOnDestroy();
  }));

  it('swallows the timeout error without redirecting', fakeAsync(() => {
    postResult = new Subject<unknown>();
    configure({ order_id: 'order-1' });
    const fixture = create();
    fixture.detectChanges();

    expect(fixture.componentInstance.checking).toBeTrue();

    // Advance past the 15s confirmation timeout to trigger the TimeoutError path.
    tick(15_000);

    expect(fixture.componentInstance.checking).toBeFalse();
    expect(cart.clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  }));

  it('swallows non-timeout errors without redirecting', fakeAsync(() => {
    postResult = throwError(() => new Error('network down'));
    configure({ order_id: 'order-1' });
    const fixture = create();
    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.checking).toBeFalse();
    expect(cart.clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  }));

  it('unsubscribes a previous in-flight confirmation before starting a new one', fakeAsync(() => {
    postResult = new Subject<unknown>();
    configure({ order_id: 'order-1' });
    const fixture = create();
    const cmp = fixture.componentInstance;

    // First init starts a pending confirmation (confirmSubscription != null).
    cmp.ngOnInit();
    expect(apiService.post).toHaveBeenCalledTimes(1);

    // Second init must unsubscribe the still-pending subscription first.
    cmp.ngOnInit();
    expect(apiService.post).toHaveBeenCalledTimes(2);

    // Cleanup the still-pending subscription + its timeout timer.
    expect(() => cmp.ngOnDestroy()).not.toThrow();
    expect(cart.clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  }));

  it('safely handles ngOnDestroy when no confirmation is in flight', () => {
    configure({});
    const fixture = create();
    fixture.detectChanges();

    expect(() => fixture.componentInstance.ngOnDestroy()).not.toThrow();
  });
});
