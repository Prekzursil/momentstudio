import { NetopiaReturnComponent } from './netopia-return.component';

/** Golden WU netopia-return-cmp-confirm-payment -- confirmPayment. */
describe('NetopiaReturnComponent confirmPayment (golden WU)', () => {
  it('invokes without throwing when dependencies are stubbed', () => {
    const cmp = Object.create(NetopiaReturnComponent.prototype) as NetopiaReturnComponent;
    Object.assign(cmp as any, {
      toast: { error: jasmine.createSpy('e'), success: jasmine.createSpy('s'), info: jasmine.createSpy('i') },
      t: (k: string) => k,
      translate: { instant: (k: string) => k },
      load: jasmine.createSpy('load'),
      save: jasmine.createSpy('save'),
      router: { navigate: jasmine.createSpy('nav'), navigateByUrl: jasmine.createSpy('navUrl') },
      cdr: { markForCheck: jasmine.createSpy('mfc'), detectChanges: jasmine.createSpy('dc') },
      destroy$: { next: jasmine.createSpy('n'), complete: jasmine.createSpy('c') },
      http: { get: jasmine.createSpy('get'), post: jasmine.createSpy('post'), put: jasmine.createSpy('put'), delete: jasmine.createSpy('delete') },
      api: {},
      auth: { user: null },
      cart: { items: [], quote: null },
      products: [],
      form: { valid: true, value: {}, patchValue: jasmine.createSpy('pv'), reset: jasmine.createSpy('reset') },
      draft: null,
      preference: 'system',
      mode: 'light',
    });
    expect(() => { (cmp as any).confirmPayment(); }).not.toThrow();
  });
});
