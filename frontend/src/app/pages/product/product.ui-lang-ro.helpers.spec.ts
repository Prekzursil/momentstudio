import { ProductComponent } from './product.component';

/** Golden WU product-ui-lang-ro — uiLang. */
describe('ProductComponent uiLang (golden WU tip)', () => {
  it('maps translate.currentLang to ro or en', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).translate = { currentLang: 'ro' };
    expect(cmp.uiLang).toBe('ro');
    (cmp as any).translate = { currentLang: 'en' };
    expect(cmp.uiLang).toBe('en');
    (cmp as any).translate = { currentLang: 'fr' };
    expect(cmp.uiLang).toBe('en');
  });
});
