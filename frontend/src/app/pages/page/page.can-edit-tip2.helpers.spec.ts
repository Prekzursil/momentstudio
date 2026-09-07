import { PageComponent } from './page.component';
describe('PageComponent canEditPage tip2 (golden WU)', () => {
  function bare(en: boolean): PageComponent {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => en } });
    return cmp;
  }
  it('mirrors enabled()', () => {
    expect(bare(true).canEditPage()).toBe(true);
    expect(bare(false).canEditPage()).toBe(false);
  });
});
