import { ProductComponent } from './product.component';

/** Golden WU tip orphan — uiLang getter. */
describe('ProductComponent uiLang (golden WU)', () => {
  function bare(lang: string): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, { translate: { currentLang: lang } });
    return cmp;
  }

  it('returns ro when currentLang is ro, otherwise en', () => {
    expect(bare('ro').uiLang).toBe('ro');
    expect(bare('en').uiLang).toBe('en');
    expect(bare('fr').uiLang).toBe('en');
  });
});
