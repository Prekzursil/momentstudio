import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { CatalogService, Category } from './catalog.service';
import { LanguageService } from './language.service';
import { StorefrontAdminModeService } from './storefront-admin-mode.service';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export const shopCategoriesResolver: ResolveFn<Category[]> = (): Observable<Category[]> => {
  const catalog = inject(CatalogService);
  const lang = inject(LanguageService).language();
  const includeHidden = inject(StorefrontAdminModeService).enabled();
  return catalog.listCategories(lang, { include_hidden: includeHidden }).pipe(catchError(() => of([])));
};
