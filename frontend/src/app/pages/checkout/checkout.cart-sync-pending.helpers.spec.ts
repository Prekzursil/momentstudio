import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — cartSyncPending. */
describe('CheckoutComponent cartSyncPending (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, { syncing: false, syncQueued: false, ...overrides });
    return cmp;
  }

  it('is true when syncing or syncQueued', () => {
    expect(bare().cartSyncPending()).toBe(false);
    expect(bare({ syncing: true }).cartSyncPending()).toBe(true);
    expect(bare({ syncQueued: true }).cartSyncPending()).toBe(true);
  });
});
