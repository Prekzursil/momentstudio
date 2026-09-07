import { ContactComponent } from './contact.component';
describe('ContactComponent canEditPage tip (golden WU)', () => {
  function bare(en: boolean): ContactComponent {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => en } });
    return cmp;
  }
  it('mirrors admin mode', () => {
    expect(bare(false).canEditPage()).toBe(false);
    expect(bare(true).canEditPage()).toBe(true);
  });
});
