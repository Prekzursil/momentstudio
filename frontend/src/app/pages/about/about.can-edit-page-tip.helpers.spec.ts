import { AboutComponent } from './about.component';

/** Golden WU tip orphan — canEditPage. */
describe('AboutComponent canEditPage (golden WU tip)', () => {
  function bare(enabled: boolean): AboutComponent {
    const cmp = Object.create(AboutComponent.prototype) as AboutComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => enabled } });
    return cmp;
  }

  it('mirrors storefrontAdminMode.enabled', () => {
    expect(bare(false).canEditPage()).toBe(false);
    expect(bare(true).canEditPage()).toBe(true);
  });
});
