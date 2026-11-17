import { ShopComponent } from './shop.component';

describe('ShopComponent canSaveCreateCategory / cancelCreateCategory (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      createSaving: false,
      createNameRo: 'Ro',
      createNameEn: 'En',
      creatingCategoryParentSlug: 'root',
      createError: 'err',
      ...overrides,
    });
    return cmp;
  }

  it('canSaveCreateCategory gates saving and trimmed names', () => {
    expect(createCmp({ createSaving: true }).canSaveCreateCategory()).toBe(false);
    expect(createCmp({ createNameRo: ' ' }).canSaveCreateCategory()).toBe(false);
    expect(createCmp({ createNameEn: '' }).canSaveCreateCategory()).toBe(false);
    expect(createCmp().canSaveCreateCategory()).toBe(true);
  });

  it('cancelCreateCategory clears draft fields', () => {
    const cmp = createCmp();
    cmp.cancelCreateCategory();
    expect((cmp as any).creatingCategoryParentSlug).toBeNull();
    expect((cmp as any).createSaving).toBe(false);
    expect((cmp as any).createError).toBe('');
    expect((cmp as any).createNameRo).toBe('');
    expect((cmp as any).createNameEn).toBe('');
  });
});
