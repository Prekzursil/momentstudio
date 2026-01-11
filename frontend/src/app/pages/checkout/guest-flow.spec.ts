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

    apiService = jasmine.createSpyObj('ApiService', ['post']);
    apiService.post.and.returnValue(of({ order_id: 'order1', reference_code: 'REF', client_secret: 'pi_secret' }));

    auth = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'user']);
    auth.isAuthenticated.and.returnValue(false);
    auth.user.and.returnValue(null);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: { items: itemsSignal, subtotal: subtotalSignal } },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } }
      ]
    });
  });

  it('renders login/register actions when signed out', fakeAsync(() => {
    spyOn(CheckoutComponent.prototype, 'ngAfterViewInit').and.returnValue(Promise.resolve());
    const fixture = TestBed.createComponent(CheckoutComponent);
    fixture.detectChanges();
    tick();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const routes = links
      .map((el) => el.getAttribute('ng-reflect-router-link'))
      .filter((v): v is string => Boolean(v));
    expect(routes).toContain('/login');
    expect(routes).toContain('/register');
    expect(apiService.post).not.toHaveBeenCalled();
  }));

  it('submits guest checkout via /orders/guest-checkout when verified', fakeAsync(() => {
    spyOn(CheckoutComponent.prototype, 'ngAfterViewInit').and.returnValue(Promise.resolve());
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
    (cmp as any).stripe = {
      confirmCardPayment: () => Promise.resolve({ error: null })
    } as any;
    (cmp as any).card = { destroy: () => {}, update: () => {} } as any;

    fixture.detectChanges();
    tick();

    cmp.placeOrder({ valid: true } as any);
    tick();

    expect(apiService.post).toHaveBeenCalled();
    const url = apiService.post.calls.mostRecent().args[0];
    expect(url).toBe('/orders/guest-checkout');
  }));
});
