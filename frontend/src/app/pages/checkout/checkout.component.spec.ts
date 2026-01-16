import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CheckoutComponent } from './checkout.component';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { CartStore } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';

describe('CheckoutComponent', () => {
  const itemsSignal = signal([
    {
      id: 'line1',
      product_id: 'p1',
      variant_id: null,
      name: 'Prod',
      slug: 'prod',
      price: 20,
      currency: 'RON',
      quantity: 1,
      stock: 5,
      image: '/img.png'
    }
  ]);
  const subtotalSignal = signal(20);

  let cartApi: any;
  let apiService: any;
  let router: any;
  let auth: any;

  beforeEach(() => {
    cartApi = jasmine.createSpyObj('CartApi', ['sync', 'headers']);
    cartApi.sync.and.returnValue(of({}));
    cartApi.headers.and.returnValue({});

    apiService = jasmine.createSpyObj('ApiService', ['post']);
    apiService.post.and.returnValue(of({ order_id: 'order1', reference_code: 'REF', client_secret: 'pi_secret' }));

    router = jasmine.createSpyObj('Router', ['navigate']);
    auth = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'user']);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true });

    TestBed.configureTestingModule({
      imports: [CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: CartStore, useValue: { items: itemsSignal, subtotal: subtotalSignal } },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } }
      ]
    });
  });

  it('submits authenticated checkout via /orders/checkout', fakeAsync(() => {
    const fixture = TestBed.createComponent(CheckoutComponent);
    const cmp = fixture.componentInstance;
    cmp.paymentMethod = 'cod';
    cmp.promo = 'SAVE';
    cmp.saveAddress = false;
    cmp.address = {
      name: 'Test User',
      email: 'test@example.com',
      line1: '123 St',
      city: 'City',
      postal: '12345',
      country: 'US',
      region: 'ST',
    } as any;

    cmp.placeOrder({ valid: true } as any);
    tick();

    expect(cartApi.sync).toHaveBeenCalled();
    expect(apiService.post).toHaveBeenCalled();
    const url = apiService.post.calls.mostRecent().args[0];
    const payload = apiService.post.calls.mostRecent().args[1] as any;
    expect(url).toBe('/orders/checkout');
    expect(payload.shipping_method_id).toBeNull();
    expect(payload.promo_code).toBe('SAVE');
    expect(payload.save_address).toBeFalse();
    expect(payload.payment_method).toBe('cod');
    expect(payload.billing_line1).toBeUndefined();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
  }));
});
