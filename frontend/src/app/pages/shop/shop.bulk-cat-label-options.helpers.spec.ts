import { ShopComponent } from './shop.component';

describe('ShopComponent bulkCategoryLabel / bulkCategoryOptions (golden WU)', () => {
  function createCmp() {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    const root: any = { id: '1', name: 'Root', parent_id: null };
    const child: any = { id: '2', name: 'Child', parent_id: '1' };
    const grand: any = { id: '3', name: 'Grand', parent_id: '2' };
    Object.assign(cmp as any, {
      categoriesById: new Map<string, any>([
        ['1', root],
        ['2', child],
        ['3', grand],
      ]),
      rootCategories: [root],
      getDescendants: jasmine
        .createSpy('getDescendants')
        .and.returnValue([child, grand, { id: '', name: '' }]),
    });
    return cmp;
  }

  it('bulkCategoryLabel walks ancestors', () => {
    const cmp = createCmp();
    expect(cmp.bulkCategoryLabel({ id: '3', name: 'Grand', parent_id: '2' } as any)).toBe(
      'Root / Child / Grand',
    );
  });

  it('bulkCategoryOptions flattens valid categories', () => {
    const cmp = createCmp();
    expect(cmp.bulkCategoryOptions().map((c: any) => c.id)).toEqual(['1', '2', '3']);
  });
});
