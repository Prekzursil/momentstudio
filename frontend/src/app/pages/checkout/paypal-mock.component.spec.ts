import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

import { PayPalMockComponent } from './paypal-mock.component';
import { ButtonComponent } from '../../shared/button.component';

/**
 * PayPalMockComponent is a local-only PayPal payment mock. On init it reads the
 * `token` query param from the route snapshot; its three actions navigate to the
 * return (success/decline) or cancel routes, but only when a token is present.
 * These specs assert the real init/guard/navigation behaviour and the token-gated
 * DOM (the "Missing token" notice and disabled buttons).
 */
describe('PayPalMockComponent', () => {
  let routerSpy: jasmine.SpyObj<Router>;

  function setup(token: string | null): ComponentFixture<PayPalMockComponent> {
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);
    routerSpy.navigate.and.resolveTo(true);

    const params: Record<string, string> = {};
    if (token !== null) {
      params['token'] = token;
    }

    TestBed.configureTestingModule({
      imports: [PayPalMockComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
        },
      ],
    });

    const fixture = TestBed.createComponent(PayPalMockComponent);
    fixture.detectChanges();
    return fixture;
  }

  function buttons(fixture: ComponentFixture<PayPalMockComponent>): ButtonComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .map((de) => de.componentInstance as ButtonComponent);
  }

  it('reads the token from the route snapshot on init', () => {
    const fixture = setup('TOKEN-123');
    expect(fixture.componentInstance.token).toBe('TOKEN-123');
  });

  it('defaults the token to an empty string when the query param is absent', () => {
    const fixture = setup(null);
    expect(fixture.componentInstance.token).toBe('');
  });

  it('exposes the breadcrumb trail', () => {
    const fixture = setup('TOKEN-123');
    expect(fixture.componentInstance.crumbs).toEqual([
      { label: 'nav.home', url: '/' },
      { label: 'checkout.title', url: '/checkout' },
      { label: 'PayPal (Mock)' },
    ]);
  });

  it('hides the missing-token notice and enables the buttons when a token exists', () => {
    const fixture = setup('TOKEN-123');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Missing token.');
    expect(buttons(fixture).every((b) => b.disabled)).toBeFalse();
  });

  it('shows the missing-token notice and disables the buttons when no token exists', () => {
    const fixture = setup(null);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Missing token.');
    expect(buttons(fixture).every((b) => b.disabled)).toBeTrue();
  });

  it('navigates to the return route with a success outcome when completing', () => {
    const fixture = setup('TOKEN-123');
    fixture.componentInstance.complete('success');
    expect(routerSpy.navigate).toHaveBeenCalledOnceWith(['/checkout/paypal/return'], {
      queryParams: { token: 'TOKEN-123', mock: 'success' },
    });
  });

  it('navigates to the return route with a decline outcome when completing', () => {
    const fixture = setup('TOKEN-123');
    fixture.componentInstance.complete('decline');
    expect(routerSpy.navigate).toHaveBeenCalledOnceWith(['/checkout/paypal/return'], {
      queryParams: { token: 'TOKEN-123', mock: 'decline' },
    });
  });

  it('navigates to the cancel route when cancelling', () => {
    const fixture = setup('TOKEN-123');
    fixture.componentInstance.cancel();
    expect(routerSpy.navigate).toHaveBeenCalledOnceWith(['/checkout/paypal/cancel'], {
      queryParams: { token: 'TOKEN-123' },
    });
  });

  it('does not navigate from complete() when the token is missing', () => {
    const fixture = setup(null);
    fixture.componentInstance.complete('success');
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate from cancel() when the token is missing', () => {
    const fixture = setup(null);
    fixture.componentInstance.cancel();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('wires the button outputs to complete() and cancel()', () => {
    const fixture = setup('TOKEN-123');
    const [successBtn, declineBtn, cancelBtn] = buttons(fixture);

    successBtn.action.emit();
    declineBtn.action.emit();
    cancelBtn.action.emit();

    expect(routerSpy.navigate).toHaveBeenCalledTimes(3);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/checkout/paypal/return'], {
      queryParams: { token: 'TOKEN-123', mock: 'success' },
    });
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/checkout/paypal/return'], {
      queryParams: { token: 'TOKEN-123', mock: 'decline' },
    });
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/checkout/paypal/cancel'], {
      queryParams: { token: 'TOKEN-123' },
    });
  });
});
