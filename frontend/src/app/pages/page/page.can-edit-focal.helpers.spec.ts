import { PageComponent } from './page.component';

/** Golden WU tip orphan — canEditPage + focalPosition. */
describe('PageComponent canEditPage / focalPosition (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): PageComponent {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => false },
      ...overrides,
    });
    return cmp;
  }

  it('canEditPage mirrors storefrontAdminMode.enabled', () => {
    expect(bare().canEditPage()).toBe(false);
    expect(bare({ storefrontAdminMode: { enabled: () => true } }).canEditPage()).toBe(true);
  });

  it('focalPosition clamps and defaults to 50% 50%', () => {
    const cmp = bare();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(10, 90)).toBe('10% 90%');
    expect(cmp.focalPosition(-5, 150)).toBe('0% 100%');
  });
});
