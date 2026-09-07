import { ContactComponent } from './contact.component';

/** Golden WU tip orphan — canEditPage. */
describe('ContactComponent canEditPage (golden WU)', () => {
  function bare(enabled: boolean): ContactComponent {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => enabled } });
    return cmp;
  }

  it('mirrors storefrontAdminMode.enabled()', () => {
    expect(bare(false).canEditPage()).toBe(false);
    expect(bare(true).canEditPage()).toBe(true);
  });
});
