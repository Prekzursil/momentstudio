import { ContactComponent } from './contact.component';

/** Tip orphan mint — ContactComponent.canEditPage (2026-09-07T08:14:48Z). */
describe('ContactComponent canEditPage helpers (golden WU)', () => {
  function bare(enabled: boolean): ContactComponent {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => enabled } });
    return cmp;
  }

  it('mirrors storefrontAdminMode.enabled', () => {
    expect(bare(false).canEditPage()).toBe(false);
    expect(bare(true).canEditPage()).toBe(true);
  });
});
