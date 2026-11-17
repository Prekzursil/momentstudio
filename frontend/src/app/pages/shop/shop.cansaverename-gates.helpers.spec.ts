import { ShopComponent } from './shop.component';

/** Golden WU shop-cansaverename-gates — canSaveRename arms. */
describe('ShopComponent canSaveRename (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      renameLoading: false,
      renameSaving: false,
      renameNameRo: 'Ro',
      renameNameEn: 'En',
      ...overrides,
    });
    return cmp;
  }

  it('returns false while renameLoading or renameSaving', () => {
    expect(createCmp({ renameLoading: true }).canSaveRename()).toBe(false);
    expect(createCmp({ renameSaving: true }).canSaveRename()).toBe(false);
  });

  it('returns false when either trimmed name is blank', () => {
    expect(createCmp({ renameNameRo: '  ' }).canSaveRename()).toBe(false);
    expect(createCmp({ renameNameEn: '' }).canSaveRename()).toBe(false);
  });

  it('returns true when both names present and not loading/saving', () => {
    expect(createCmp().canSaveRename()).toBe(true);
  });
});
