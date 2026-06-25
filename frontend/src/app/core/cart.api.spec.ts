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
      providers: [ApiService, CartApi],
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
    req.flush({
      items: [{ id: '1' }],
      totals: { subtotal: '0', tax: '0', shipping: '0', total: '0' },
    });
  });

  it('reuses an existing session id', () => {
    expect(api.getSessionId()).toBe('guest-test');
  });

  it('generates a new session id with crypto.randomUUID when none exists', () => {
    localStorage.removeItem('cart_session_id');
    spyOn(crypto, 'randomUUID').and.returnValue(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as `${string}-${string}-${string}-${string}-${string}`,
    );
    const id = api.getSessionId();
    expect(id).toBe('guest-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(localStorage.getItem('cart_session_id')).toBe(id);
  });

  it('falls back to Date.now when randomUUID is unavailable', () => {
    localStorage.removeItem('cart_session_id');
    const original = crypto.randomUUID;
    (crypto as { randomUUID?: unknown }).randomUUID = undefined;
    try {
      const id = api.getSessionId();
      expect(id.startsWith('guest-')).toBeTrue();
      expect(id).not.toContain('undefined');
    } finally {
      crypto.randomUUID = original;
    }
  });

  it('headers returns an empty object when there is no session id', () => {
    spyOn(api, 'getSessionId').and.returnValue('');
    expect(api.headers()).toEqual({});
  });

  it('sync posts items with the session header', () => {
    api.sync([{ product_id: 'p1', quantity: 2 }]).subscribe((res) => {
      expect(res.id).toBe('c1');
    });
    const req = httpMock.expectOne('/api/v1/cart/sync');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ items: [{ product_id: 'p1', quantity: 2 }] });
    expect(req.request.headers.get('X-Session-Id')).toBe('guest-test');
    req.flush({ id: 'c1', items: [], totals: {} });
  });

  it('addItem posts the body', () => {
    api.addItem({ product_id: 'p1', quantity: 1 }).subscribe();
    const req = httpMock.expectOne('/api/v1/cart/items');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'i1' });
  });

  it('deleteItem deletes by id with the session header', () => {
    api.deleteItem('i1').subscribe();
    const req = httpMock.expectOne('/api/v1/cart/items/i1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.headers.get('X-Session-Id')).toBe('guest-test');
    req.flush(null);
  });
});
