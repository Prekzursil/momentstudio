import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CartApi } from './cart.api';
import { ApiService } from './api.service';

describe('CartApi', () => {
  let api: CartApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, CartApi]
    });
    api = TestBed.inject(CartApi);
    httpMock = TestBed.inject(HttpTestingController);
    // ensure a stable session id for assertions
    localStorage.setItem('cart_session_id', 'guest-test');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem('cart_session_id');
  });

  it('should call payment intent with session header', () => {
    api.paymentIntent().subscribe((res) => {
      expect(res.client_secret).toBe('secret');
      expect(res.intent_id).toBe('pi_123');
    });

    const req = httpMock.expectOne('/api/v1/payments/intent');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Session-Id')).toBe('guest-test');
    req.flush({ client_secret: 'secret', intent_id: 'pi_123' });
  });

  it('should call cart get with session header', () => {
    api.get().subscribe((res) => {
      expect(res.items.length).toBe(1);
    });

    const req = httpMock.expectOne('/api/v1/cart');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('X-Session-Id')).toBe('guest-test');
    req.flush({ items: [{ id: '1' }], totals: { subtotal: '0', tax: '0', shipping: '0', total: '0' } });
  });
});
