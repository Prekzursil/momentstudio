import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CheckoutComponent } from './checkout.component';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CartStore } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';
import { RouterTestingModule } from '@angular/router/testing';

describe('Checkout auth gating', () => {
  const itemsSignal = signal([
    {
      id: 'line1',
      product_id: 'p1',
      variant_id: null,
      name: 'Prod',
      slug: 'prod',
      price: 30,
      currency: 'RON',
      quantity: 2,
      stock: 5,
      image: '/img.png'
    }
  ]);
  const subtotalSignal = signal(60);

  let cartApi: any;
  let apiService: any;
  let auth: any;

  beforeEach(() => {
    cartApi = jasmine.createSpyObj('CartApi', ['sync', 'headers']);
    cartApi.sync.and.returnValue(of({}));
    cartApi.headers.and.returnValue({});

    apiService = jasmine.createSpyObj('ApiService', ['post', 'get']);
    apiService.post.and.returnValue(of({ order_id: 'order1', reference_code: 'REF', payment_method: 'cod' }));
    apiService.get.and.returnValue(of({ email: null, verified: false }));

    auth = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'user']);
    auth.isAuthenticated.and.returnValue(false);
    auth.user.and.returnValue(null);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: { items: itemsSignal, subtotal: subtotalSignal, clear: jasmine.createSpy('clear') } },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } }
      ]
    });
  });

  it('renders login/register actions when signed out', fakeAsync(() => {
    const fixture = TestBed.createComponent(CheckoutComponent);
    fixture.detectChanges();
    tick();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links
      .map((el) => el.getAttribute('href'))
      .filter((v): v is string => Boolean(v));
    expect(hrefs.some((h) => h.includes('/login'))).toBeTrue();
    expect(hrefs.some((h) => h.includes('/register'))).toBeTrue();
    expect(apiService.post).not.toHaveBeenCalled();
  }));

  it('submits guest checkout via /orders/guest-checkout when verified', fakeAsync(() => {
    apiService.get.and.returnValue(of({ email: 'guest@example.com', verified: true }));
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    const fixture = TestBed.createComponent(CheckoutComponent);
    const cmp = fixture.componentInstance;
    cmp.address = {
      name: 'Guest',
      email: 'guest@example.com',
      line1: '123 St',
      city: 'City',
      postal: '12345',
      country: 'RO',
      region: '',
      line2: ''
    } as any;
    cmp.guestEmailVerified = true;

    fixture.detectChanges();
    tick();

    cmp.placeOrder({ valid: true } as any);
    tick();

    expect(apiService.post).toHaveBeenCalled();
    const url = apiService.post.calls.mostRecent().args[0];
    expect(url).toBe('/orders/guest-checkout');
  }));
});
