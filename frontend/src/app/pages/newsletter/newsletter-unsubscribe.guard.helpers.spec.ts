import { NewsletterUnsubscribeComponent } from './newsletter-unsubscribe.component';

/** Golden WU tip orphan — unsubscribe early-return guards. */
describe('NewsletterUnsubscribeComponent unsubscribe guards (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): NewsletterUnsubscribeComponent {
    const cmp = Object.create(NewsletterUnsubscribeComponent.prototype) as NewsletterUnsubscribeComponent;
    Object.assign(cmp as any, {
      loading: false,
      success: false,
      token: 'tok',
      errorMessage: '',
      newsletter: { unsubscribe: () => ({ subscribe: () => undefined }) },
      ...overrides,
    });
    return cmp;
  }

  it('no-ops when loading, success, or token missing', () => {
    const spy = jasmine.createSpy('unsubscribe').and.returnValue({ subscribe: () => undefined });
    expect(() => bare({ loading: true, newsletter: { unsubscribe: spy } }).unsubscribe()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(() => bare({ success: true, newsletter: { unsubscribe: spy } }).unsubscribe()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(() => bare({ token: '', newsletter: { unsubscribe: spy } }).unsubscribe()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
