import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { shopCategoriesResolver } from './shop.resolver';
import { CatalogService, Category } from './catalog.service';
import { LanguageService } from './language.service';
import { StorefrontAdminModeService } from './storefront-admin-mode.service';

describe('shopCategoriesResolver', () => {
  const catalog = {
    listCategories: jasmine.createSpy('listCategories'),
  };
  const languageMock = {
    language: jasmine.createSpy('language'),
  };
  const adminModeMock = {
    enabled: jasmine.createSpy('enabled'),
  };

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: LanguageService, useValue: languageMock },
        { provide: StorefrontAdminModeService, useValue: adminModeMock },
      ],
    });
  }

  function run(): Promise<Category[]> {
    const result = TestBed.runInInjectionContext(() =>
      shopCategoriesResolver({} as any, {} as any),
    ) as ReturnType<typeof shopCategoriesResolver>;
    return firstValueFrom(result as any);
  }

  beforeEach(() => {
    catalog.listCategories.calls.reset();
    languageMock.language.calls.reset();
    adminModeMock.enabled.calls.reset();
    configure();
  });

  it('resolves categories using the current language and excludes hidden when admin mode is off', async () => {
    const categories: Category[] = [{ id: '1', slug: 'rings', name: 'Rings' }];
    languageMock.language.and.returnValue('en');
    adminModeMock.enabled.and.returnValue(false);
    catalog.listCategories.and.returnValue(of(categories));

    const resolved = await run();

    expect(resolved).toEqual(categories);
    expect(catalog.listCategories).toHaveBeenCalledOnceWith('en', { include_hidden: false });
  });

  it('includes hidden categories when storefront admin mode is enabled', async () => {
    const categories: Category[] = [
      { id: '1', slug: 'rings', name: 'Rings' },
      { id: '2', slug: 'hidden', name: 'Hidden', is_visible: false },
    ];
    languageMock.language.and.returnValue('ro');
    adminModeMock.enabled.and.returnValue(true);
    catalog.listCategories.and.returnValue(of(categories));

    const resolved = await run();

    expect(resolved).toEqual(categories);
    expect(catalog.listCategories).toHaveBeenCalledOnceWith('ro', { include_hidden: true });
  });

  it('falls back to an empty array when listing categories fails', async () => {
    languageMock.language.and.returnValue('en');
    adminModeMock.enabled.and.returnValue(false);
    catalog.listCategories.and.returnValue(throwError(() => new Error('network down')));

    const resolved = await run();

    expect(resolved).toEqual([]);
  });
});
