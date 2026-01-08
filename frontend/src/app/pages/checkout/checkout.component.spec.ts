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

  beforeEach(() => {
    cartApi = jasmine.createSpyObj('CartApi', ['sync', 'paymentIntent', 'headers'], {
      headers: () => ({})
    });
    cartApi.sync.and.returnValue(of({}));
    cartApi.paymentIntent.and.returnValue(of({ client_secret: 'pi_secret', intent_id: 'pi_1' }));

    apiService = jasmine.createSpyObj('ApiService', ['post']);
    apiService.post.and.returnValue(of({ order_id: 'order1', reference_code: 'REF', client_secret: 'pi_secret' }));

    router = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      imports: [CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: CartStore, useValue: { items: itemsSignal, subtotal: subtotalSignal } },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: apiService },
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } }
      ]
    });
  });

  it('submits checkout with shipping, promo, and create_account flags', fakeAsync(() => {
    const fixture = TestBed.createComponent(CheckoutComponent);
    const cmp = fixture.componentInstance;
    cmp.mode = 'create';
    cmp.shipping = 'ship123';
    cmp.promo = 'SAVE';
    cmp.address = {
      name: 'Test User',
      email: 'test@example.com',
      line1: '123 St',
      city: 'City',
      postal: '12345',
      country: 'US',
      region: 'ST',
      password: 'password'
    } as any;
    (cmp as any).stripe = {
      confirmCardPayment: () => Promise.resolve({ error: null })
    } as any;
    (cmp as any).card = { destroy: () => {} } as any;
    (cmp as any).clientSecret = 'pi_secret';

    cmp.placeOrder({ valid: true } as any);
    tick();

    expect(cartApi.sync).toHaveBeenCalled();
    expect(apiService.post).toHaveBeenCalled();
    const payload = apiService.post.calls.mostRecent().args[1];
    expect(payload.shipping_method_id).toBe('ship123');
    expect(payload.promo_code).toBe('SAVE');
    expect(payload.create_account).toBeTrue();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
  }));
});
