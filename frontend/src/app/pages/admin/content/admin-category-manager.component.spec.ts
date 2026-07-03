import { of, throwError } from 'rxjs';

import { AdminCategoryManagerComponent } from './admin-category-manager.component';
import { AdminCategory } from '../../../core/admin.service';

/**
 * Unit spec for the extracted Category management panel. These tests exercise the
 * component's methods directly (the panel is OnPush and its behaviour is
 * identical to the code that previously lived in AdminComponent — they were ported
 * from the monolith's category suites when the feature was decomposed).
 */

type AnySpy = jasmine.SpyObj<any>;

interface Env {
  component: AdminCategoryManagerComponent;
  admin: AnySpy;
  toast: AnySpy;
  emitted: AdminCategory[][];
}

function build(): Env {
  const admin = jasmine.createSpyObj('AdminService', [
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'reorderCategories',
    'getCategoryTranslations',
    'upsertCategoryTranslation',
    'deleteCategoryTranslation',
  ]);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const translate = { instant: (k: string) => k } as any;

  const component = new AdminCategoryManagerComponent(admin as any, toast as any, translate);
  const emitted: AdminCategory[][] = [];
  component.categoriesChange.subscribe((next) => emitted.push(next));
  return { component, admin, toast, emitted };
}

describe('AdminCategoryManagerComponent — wizard', () => {
  it('start/exit toggle the wizard state', () => {
    const env = build();
    env.component.startCategoryWizard();
    expect(env.component.categoryWizardOpen()).toBeTrue();
    expect(env.component.categoryWizardStep()).toBe(0);
    env.component.exitCategoryWizard();
    expect(env.component.categoryWizardOpen()).toBeFalse();
  });

  it('canNext is false while closed and reflects the current step/slug', () => {
    const env = build();
    expect(env.component.categoryWizardCanNext()).toBeFalse(); // closed
    env.component.startCategoryWizard();
    expect(env.component.categoryWizardCanNext()).toBeFalse(); // open, no slug
    expect(env.component.categoryWizardNextLabelKey()).toBe('adminUi.actions.next');
    env.component.categoryWizardSlug.set('slug-1');
    expect(env.component.categoryWizardCanNext()).toBeTrue();
    env.component.categoryWizardStep.set(1);
    expect(env.component.categoryWizardNextLabelKey()).toBe('adminUi.actions.done');
    expect(env.component.categoryWizardCanNext()).toBeTrue(); // last step
  });

  it('runs the wizard navigation with guards', () => {
    const env = build();
    env.component.startCategoryWizard();
    env.component.categoryWizardNext(); // cannot advance without slug
    expect(env.toast.error).toHaveBeenCalled();
    expect(env.component.categoryWizardStep()).toBe(0);

    env.component.categoryWizardSlug.set('slug-1');
    const openTr = spyOn(env.component, 'openCategoryWizardTranslations').and.stub();
    env.component.categoryWizardNext();
    expect(env.component.categoryWizardStep()).toBe(1);
    expect(openTr).toHaveBeenCalled();

    env.component.categoryWizardPrev();
    expect(env.component.categoryWizardStep()).toBe(0);
    env.component.categoryWizardPrev(); // already 0 → no-op
    expect(env.component.categoryWizardStep()).toBe(0);

    env.component.categoryWizardStep.set(1);
    env.component.categoryWizardNext(); // last step → exit
    expect(env.component.categoryWizardOpen()).toBeFalse();
  });

  it('categoryWizardNext is a no-op when the wizard is closed', () => {
    const env = build();
    env.component.categoryWizardNext();
    expect(env.component.categoryWizardOpen()).toBeFalse();
    expect(env.component.categoryWizardStep()).toBe(0);
  });

  it('goToCategoryWizardStep validates bounds + slug', () => {
    const env = build();
    env.component.goToCategoryWizardStep(0); // closed → no-op
    expect(env.component.categoryWizardOpen()).toBeFalse();
    env.component.startCategoryWizard();
    env.component.goToCategoryWizardStep(-1);
    env.component.goToCategoryWizardStep(99);
    expect(env.component.categoryWizardStep()).toBe(0);
    env.component.goToCategoryWizardStep(1); // needs slug
    expect(env.toast.error).toHaveBeenCalled();
    expect(env.component.categoryWizardStep()).toBe(0);
    env.component.categoryWizardSlug.set('s');
    const openTr = spyOn(env.component, 'openCategoryWizardTranslations').and.stub();
    env.component.goToCategoryWizardStep(1);
    expect(openTr).toHaveBeenCalled();
    expect(env.component.categoryWizardStep()).toBe(1);
  });

  it('categoryWizardDescriptionKey falls back to basics', () => {
    const env = build();
    env.component.categoryWizardStep.set(99);
    expect(env.component.categoryWizardDescriptionKey()).toBe(
      'adminUi.categories.wizard.desc.basics',
    );
  });

  it('openCategoryWizardTranslations is a no-op without a slug and loads once', () => {
    const env = build();
    env.component.openCategoryWizardTranslations();
    expect(env.admin.getCategoryTranslations).not.toHaveBeenCalled();
    env.component.categoryWizardSlug.set('s');
    env.admin.getCategoryTranslations.and.returnValue(of([]));
    env.component.openCategoryWizardTranslations();
    expect(env.component.categoryTranslationsSlug).toBe('s');
    env.component.openCategoryWizardTranslations(); // already open for this slug → no reload
    expect(env.admin.getCategoryTranslations).toHaveBeenCalledTimes(1);
  });
});

describe('AdminCategoryManagerComponent — create', () => {
  it('addCategory validates name then prepends the created category and emits', () => {
    const env = build();
    env.component.categoryName = '';
    env.component.addCategory();
    expect(env.toast.error).toHaveBeenCalled();
    expect(env.admin.createCategory).not.toHaveBeenCalled();

    env.component.categoryName = 'New';
    env.component.categoryParentId = ' p1 ';
    env.component.categories = [{ id: 'old' }] as any;
    env.admin.createCategory.and.returnValue(of({ id: 'new', slug: 'new-cat' }));
    env.component.addCategory();
    expect(env.admin.createCategory).toHaveBeenCalledWith({ name: 'New', parent_id: 'p1' });
    expect(env.component.categories[0]).toEqual({ id: 'new', slug: 'new-cat' } as any);
    expect(env.component.categoryName).toBe('');
    expect(env.component.categoryParentId).toBe('');
    expect(env.emitted.length).toBe(1);
    expect(env.emitted[0][0]).toEqual({ id: 'new', slug: 'new-cat' } as any);
  });

  it('addCategory advances the open wizard to translations', () => {
    const env = build();
    env.component.startCategoryWizard();
    env.component.categoryName = 'New';
    env.admin.createCategory.and.returnValue(of({ id: 'new', slug: 'new-cat' }));
    const openTr = spyOn(env.component, 'openCategoryWizardTranslations').and.stub();
    env.component.addCategory();
    expect(env.component.categoryWizardSlug()).toBe('new-cat');
    expect(env.component.categoryWizardStep()).toBe(1);
    expect(openTr).toHaveBeenCalled();
  });

  it('addCategory tolerates a created category without a slug', () => {
    const env = build();
    env.component.startCategoryWizard();
    env.component.categoryName = 'New';
    env.admin.createCategory.and.returnValue(of({ id: 'new' }));
    env.component.addCategory();
    expect(env.component.categoryWizardStep()).toBe(0);
  });

  it('addCategory toasts on failure', () => {
    const env = build();
    env.component.categoryName = 'New';
    env.admin.createCategory.and.returnValue(throwError(() => new Error('x')));
    env.component.addCategory();
    expect(env.toast.error).toHaveBeenCalled();
  });
});

describe('AdminCategoryManagerComponent — hierarchy', () => {
  it('categoryParentLabel resolves none/found/missing parents', () => {
    const env = build();
    env.component.categories = [
      { id: 'p', name: 'Parent' },
      { id: 'c', name: 'Child', parent_id: 'p' },
    ] as any;
    expect(env.component.categoryParentLabel({ parent_id: '' } as any)).toBe(
      'adminUi.categories.parentNone',
    );
    expect(env.component.categoryParentLabel({ parent_id: 'p' } as any)).toBe('Parent');
    expect(env.component.categoryParentLabel({ parent_id: 'missing' } as any)).toBe(
      'adminUi.categories.parentNone',
    );
  });

  it('categoryParentOptions excludes self + descendants and sorts by name', () => {
    const env = build();
    env.component.categories = [
      { id: 'root', name: 'Root' },
      { id: 'child', name: 'Child', parent_id: 'root' },
      { id: 'child2', name: 'Child2', parent_id: 'root' }, // 2nd child of root exercises the bucket-append path
      { id: 'grand', name: 'Grand', parent_id: 'child' },
      { id: 'other', name: 'Other' },
    ] as any;
    const options = env.component.categoryParentOptions({ id: 'root' } as any).map((c) => c.id);
    expect(options).toEqual(['other']);
  });

  it('categoryParentOptions sorts nullish-name categories before named ones', () => {
    const env = build();
    env.component.categories = [
      { id: 'a', slug: 'a', name: null, parent_id: null },
      { id: 'b', slug: 'b', name: 'Beta', parent_id: null },
      { id: 'c', slug: 'c', name: 'Alpha', parent_id: 'x' },
    ] as any;
    const opts = env.component.categoryParentOptions({ id: 'x' } as any).map((o) => o.id);
    // 'x' (self) and 'c' (descendant of x) excluded; '' (null name) sorts before 'Beta'.
    expect(opts).toEqual(['a', 'b']);
  });

  it('categoryDescendantIds resolves nested children and survives cycles', () => {
    const env = build();
    env.component.categories = [
      { id: 'p', slug: 'p', name: 'P', parent_id: 'c2' },
      { id: 'c1', slug: 'c1', name: 'C1', parent_id: 'p' },
      { id: 'c2', slug: 'c2', name: 'C2', parent_id: 'c1' },
    ] as any;
    // p plus its descendants (c1, c2 via the cycle) are all excluded.
    expect(env.component.categoryParentOptions({ id: 'p' } as any)).toEqual([]);
  });

  it('updateCategoryParent skips no-ops, persists and rolls back', () => {
    const env = build();
    const cat = { slug: 's', parent_id: 'p' } as any;
    env.component.updateCategoryParent(cat, 'p');
    expect(env.admin.updateCategory).not.toHaveBeenCalled();
    env.admin.updateCategory.and.returnValue(of({ parent_id: 'q' }));
    env.component.updateCategoryParent(cat, 'q');
    expect(cat.parent_id).toBe('q');
    env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
    env.component.updateCategoryParent(cat, 'r');
    expect(cat.parent_id).toBe('q');
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.updateParent');
  });

  it('updateCategoryParent clears the parent for nullish input and echoes null', () => {
    const env = build();
    const cat = { slug: 's', parent_id: 'old' } as any;
    env.admin.updateCategory.and.returnValue(of({ parent_id: null }));
    env.component.updateCategoryParent(cat, null as any);
    expect(env.admin.updateCategory).toHaveBeenCalledWith('s', { parent_id: null });
    expect(cat.parent_id).toBeNull();
    expect(env.toast.success).toHaveBeenCalled();
  });

  it('updateCategoryLowStockThreshold validates, ignores no-ops, persists and reverts', () => {
    const env = build();
    const bad = { slug: 's', low_stock_threshold: 5 } as any;
    env.component.updateCategoryLowStockThreshold(bad, '-1');
    expect(bad.low_stock_threshold).toBe(5);
    expect(env.toast.error).toHaveBeenCalledWith(
      'adminUi.categories.errors.updateLowStockThreshold',
    );

    const same = { slug: 's', low_stock_threshold: null } as any;
    env.component.updateCategoryLowStockThreshold(same, '   ');
    expect(env.admin.updateCategory).not.toHaveBeenCalled();

    const ok = { slug: 's', low_stock_threshold: null } as any;
    env.admin.updateCategory.and.returnValue(of({ low_stock_threshold: 7 }));
    env.component.updateCategoryLowStockThreshold(ok, '7');
    expect(ok.low_stock_threshold).toBe(7);

    const fail = { slug: 's', low_stock_threshold: 1 } as any;
    env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
    env.component.updateCategoryLowStockThreshold(fail, '9');
    expect(fail.low_stock_threshold).toBe(1);
  });

  it('updateCategoryLowStockThreshold clears the threshold for nullish input', () => {
    const env = build();
    const cat = { slug: 's', low_stock_threshold: 5 } as any;
    env.admin.updateCategory.and.returnValue(of({ low_stock_threshold: null }));
    env.component.updateCategoryLowStockThreshold(cat, null as any);
    expect(env.admin.updateCategory).toHaveBeenCalledWith('s', { low_stock_threshold: null });
    expect(cat.low_stock_threshold).toBeNull();
  });

  it('updateCategoryTaxGroup ignores no-ops, persists and reverts', () => {
    const env = build();
    const cat = { slug: 's', tax_group_id: 'g1' } as any;
    env.component.updateCategoryTaxGroup(cat, 'g1');
    expect(env.admin.updateCategory).not.toHaveBeenCalled();
    env.admin.updateCategory.and.returnValue(of({ tax_group_id: 'g2' }));
    env.component.updateCategoryTaxGroup(cat, 'g2');
    expect(cat.tax_group_id).toBe('g2');
    env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
    env.component.updateCategoryTaxGroup(cat, 'g3');
    expect(cat.tax_group_id).toBe('g2');
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.taxes.errors.categoryAssign');
  });

  it('updateCategoryTaxGroup clears the group for nullish input', () => {
    const env = build();
    const cat = { slug: 's', tax_group_id: 'g1' } as any;
    env.admin.updateCategory.and.returnValue(of({ tax_group_id: null }));
    env.component.updateCategoryTaxGroup(cat, null as any);
    expect(env.admin.updateCategory).toHaveBeenCalledWith('s', { tax_group_id: null });
    expect(cat.tax_group_id).toBeNull();
  });
});

describe('AdminCategoryManagerComponent — delete', () => {
  it('open/close delete confirm toggles the modal state', () => {
    const env = build();
    const cat = { slug: 's' } as any;
    env.component.openCategoryDeleteConfirm(cat);
    expect(env.component.categoryDeleteConfirmOpen()).toBeTrue();
    expect(env.component.categoryDeleteConfirmTarget()).toBe(cat);
    env.component.closeCategoryDeleteConfirm();
    expect(env.component.categoryDeleteConfirmOpen()).toBeFalse();
    expect(env.component.categoryDeleteConfirmTarget()).toBeNull();
  });

  it('confirmDeleteCategory deletes the target, removes the row and closes', () => {
    const env = build();
    const cat = { slug: 's' } as any;
    env.component.openCategoryDeleteConfirm(cat);
    env.admin.deleteCategory.and.returnValue(of({}));
    env.component.categories = [{ slug: 's' }, { slug: 't' }] as any;
    env.component.confirmDeleteCategory();
    expect(env.component.categories.map((x) => x.slug)).toEqual(['t']);
    expect(env.component.categoryDeleteConfirmOpen()).toBeFalse();
    expect(env.emitted[env.emitted.length - 1].map((x) => x.slug)).toEqual(['t']);
  });

  it('confirmDeleteCategory guards on missing target + busy', () => {
    const env = build();
    env.component.confirmDeleteCategory();
    expect(env.admin.deleteCategory).not.toHaveBeenCalled();
    env.component.categoryDeleteConfirmTarget.set({ slug: 's' } as any);
    env.component.categoryDeleteConfirmBusy.set(true);
    env.component.confirmDeleteCategory();
    expect(env.admin.deleteCategory).not.toHaveBeenCalled();
  });

  it('deleteCategory closes open translations on success and reports the outcome', () => {
    const env = build();
    env.component.categoryTranslationsSlug = 's';
    env.admin.deleteCategory.and.returnValue(of({}));
    env.component.categories = [{ slug: 's' }] as any;
    const done = jasmine.createSpy('done');
    env.component.deleteCategory('s', { done });
    expect(env.component.categoryTranslationsSlug).toBeNull();
    expect(done).toHaveBeenCalledWith(true);
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.success.delete');

    env.admin.deleteCategory.and.returnValue(throwError(() => new Error('x')));
    const done2 = jasmine.createSpy('done2');
    env.component.deleteCategory('z', { done: done2 });
    expect(done2).toHaveBeenCalledWith(false);
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.delete');
  });
});

describe('AdminCategoryManagerComponent — translations', () => {
  it('toggleCategoryTranslations opens then closes', () => {
    const env = build();
    env.admin.getCategoryTranslations.and.returnValue(
      of([{ lang: 'en', name: 'N', description: 'D' }]),
    );
    env.component.toggleCategoryTranslations('s');
    expect(env.component.categoryTranslationsSlug).toBe('s');
    expect(env.component.categoryTranslationExists.en).toBeTrue();
    env.component.toggleCategoryTranslations('s');
    expect(env.component.categoryTranslationsSlug).toBeNull();
  });

  it('saveCategoryTranslation validates + persists', () => {
    const env = build();
    env.component.saveCategoryTranslation('en');
    expect(env.admin.upsertCategoryTranslation).not.toHaveBeenCalled();
    env.component.categoryTranslationsSlug = 's';
    env.component.categoryTranslations.en = { name: '', description: '' };
    env.component.saveCategoryTranslation('en');
    expect(env.toast.error).toHaveBeenCalled();
    env.component.categoryTranslations.en = { name: 'Name', description: 'Desc' };
    env.admin.upsertCategoryTranslation.and.returnValue(of({ name: 'Name', description: 'Desc' }));
    env.component.saveCategoryTranslation('en');
    expect(env.admin.upsertCategoryTranslation).toHaveBeenCalledWith('s', 'en', {
      name: 'Name',
      description: 'Desc',
    });
    expect(env.component.categoryTranslationExists.en).toBeTrue();
  });

  it('saveCategoryTranslation persists an empty description as null', () => {
    const env = build();
    env.component.categoryTranslationsSlug = 's';
    env.component.categoryTranslations.ro = { name: 'Nume', description: '  ' };
    env.admin.upsertCategoryTranslation.and.returnValue(of({ name: 'Nume', description: '' }));
    env.component.saveCategoryTranslation('ro');
    expect(env.admin.upsertCategoryTranslation).toHaveBeenCalledWith('s', 'ro', {
      name: 'Nume',
      description: null,
    });
  });

  it('saveCategoryTranslation surfaces an error', () => {
    const env = build();
    env.component.categoryTranslationsSlug = 's';
    env.component.categoryTranslations.ro = { name: 'Nume', description: '' };
    env.admin.upsertCategoryTranslation.and.returnValue(throwError(() => new Error('x')));
    env.component.saveCategoryTranslation('ro');
    expect(env.component.categoryTranslationsError()).toBe(
      'adminUi.categories.translations.errors.save',
    );
  });

  it('deleteCategoryTranslation guards, persists and errors', () => {
    const env = build();
    env.component.deleteCategoryTranslation('en');
    expect(env.admin.deleteCategoryTranslation).not.toHaveBeenCalled();
    env.component.categoryTranslationsSlug = 's';
    env.component.categoryTranslationExists.en = true;
    env.admin.deleteCategoryTranslation.and.returnValue(of({}));
    env.component.deleteCategoryTranslation('en');
    expect(env.component.categoryTranslationExists.en).toBeFalse();
    env.admin.deleteCategoryTranslation.and.returnValue(throwError(() => new Error('x')));
    env.component.deleteCategoryTranslation('ro');
    expect(env.component.categoryTranslationsError()).toBe(
      'adminUi.categories.translations.errors.delete',
    );
  });

  it('loadCategoryTranslations maps known langs, skips others and errors', () => {
    const env = build();
    env.admin.getCategoryTranslations.and.returnValue(
      of([
        { lang: 'en', name: 'EN', description: 'd' },
        { lang: 'fr', name: 'skip' },
      ]),
    );
    (env.component as any).loadCategoryTranslations('s');
    expect(env.component.categoryTranslationExists.en).toBeTrue();
    expect(env.component.categoryTranslationExists.ro).toBeFalse();
    expect(env.component.categoryTranslations.en.name).toBe('EN');
    env.admin.getCategoryTranslations.and.returnValue(throwError(() => new Error('x')));
    (env.component as any).loadCategoryTranslations('s');
    expect(env.component.categoryTranslationsError()).toBe(
      'adminUi.categories.translations.errors.load',
    );
  });
});

describe('AdminCategoryManagerComponent — reorder + drag', () => {
  it('moveCategory swaps sort order, persists and emits the new list', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ] as any;
    env.admin.reorderCategories.and.returnValue(
      of([
        { slug: 'b', sort_order: 0 },
        { slug: 'a', sort_order: 1 },
      ]),
    );
    env.component.moveCategory({ slug: 'a' } as any, 1);
    expect(env.admin.reorderCategories).toHaveBeenCalled();
    expect(env.component.categories[0].slug).toBe('b');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.success.reorder');
    expect(env.emitted[env.emitted.length - 1][0].slug).toBe('b');
  });

  it('moveCategory ignores out-of-range swaps', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b' /* missing sort_order */ },
      { slug: 'c', sort_order: 2 },
    ] as any;
    env.component.moveCategory({ slug: 'a' } as any, -1); // swapIndex < 0
    env.component.moveCategory({ slug: 'c', sort_order: 2 } as any, 1); // swapIndex >= length
    env.component.moveCategory({ slug: 'missing' } as any, 1); // index < 0
    expect(env.admin.reorderCategories).not.toHaveBeenCalled();
  });

  it('moveCategory reorders categories whose sort_order is undefined', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: undefined },
      { slug: 'b', sort_order: undefined },
    ] as any;
    env.admin.reorderCategories.and.returnValue(of([{ slug: 'b' }, { slug: 'a' }]));
    env.component.moveCategory(env.component.categories[0], 1);
    expect(env.admin.reorderCategories).toHaveBeenCalledWith([
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 0 },
    ]);
    expect(env.component.categories.map((x) => x.slug)).toEqual(['b', 'a']);
  });

  it('moveCategory toasts on failure', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ] as any;
    env.admin.reorderCategories.and.returnValue(throwError(() => new Error('x')));
    env.component.moveCategory({ slug: 'a' } as any, 1);
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.reorder');
  });

  it('drag start/over/drop reorders categories and clears the dragging slug', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ] as any;
    env.component.onCategoryDragStart('a');
    expect(env.component.draggingSlug).toBe('a');
    const evt = { preventDefault: jasmine.createSpy('pd') } as any;
    env.component.onCategoryDragOver(evt);
    expect(evt.preventDefault).toHaveBeenCalled();
    env.admin.reorderCategories.and.returnValue(
      of([
        { slug: 'b', sort_order: 0 },
        { slug: 'a', sort_order: 1 },
      ]),
    );
    env.component.onCategoryDrop('b');
    expect(env.admin.reorderCategories).toHaveBeenCalled();
    expect(env.component.draggingSlug).toBeNull();
  });

  it('onCategoryDrop reorders categories whose sort_order is undefined', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: undefined },
      { slug: 'b', sort_order: undefined },
    ] as any;
    env.component.draggingSlug = 'a';
    env.admin.reorderCategories.and.returnValue(of([{ slug: 'b' }, { slug: 'a' }]));
    env.component.onCategoryDrop('b');
    expect(env.admin.reorderCategories).toHaveBeenCalled();
    expect(env.component.categories.map((x) => x.slug)).toEqual(['b', 'a']);
    expect(env.component.draggingSlug).toBeNull();
  });

  it('onCategoryDrop reports a reorder error', () => {
    const env = build();
    env.component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ] as any;
    env.admin.reorderCategories.and.returnValue(throwError(() => new Error('x')));
    env.component.draggingSlug = 'a';
    env.component.onCategoryDrop('b');
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.reorder');
  });

  it('onCategoryDrop short-circuits empty/identical/missing targets', () => {
    const env = build();
    env.component.onCategoryDrop('x'); // no dragging slug
    env.component.draggingSlug = 'a';
    env.component.onCategoryDrop('a'); // identical
    expect(env.component.draggingSlug).toBeNull();
    env.component.categories = [{ slug: 'a' }] as any;
    env.component.draggingSlug = 'ghost';
    env.component.onCategoryDrop('a'); // dragging slug not found
    expect(env.component.draggingSlug).toBeNull();
    env.component.draggingSlug = 'a';
    env.component.onCategoryDrop('ghost'); // target not found
    expect(env.component.draggingSlug).toBeNull();
    expect(env.admin.reorderCategories).not.toHaveBeenCalled();
  });
});
