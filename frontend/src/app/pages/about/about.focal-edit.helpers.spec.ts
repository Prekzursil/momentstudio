import { AboutComponent } from './about.component';

/** Golden WU tip-recon #708 — focalPosition + canEditPage (2026-09-06T12:38:37Z). */
describe('AboutComponent focalPosition / canEditPage (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): AboutComponent {
    const cmp = Object.create(AboutComponent.prototype) as AboutComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => false },
      ...overrides,
    });
    return cmp;
  }

  it('focalPosition clamps and defaults to 50% 50%', () => {
    const cmp = bare();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(10, 90)).toBe('10% 90%');
    expect(cmp.focalPosition(-5, 150)).toBe('0% 100%');
    expect(cmp.focalPosition(12.6, 33.4)).toBe('13% 33%');
  });

  it('canEditPage mirrors storefrontAdminMode.enabled', () => {
    expect(bare().canEditPage()).toBe(false);
    expect(bare({ storefrontAdminMode: { enabled: () => true } }).canEditPage()).toBe(true);
  });
});
