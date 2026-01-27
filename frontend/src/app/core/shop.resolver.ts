import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { CatalogService, Category } from './catalog.service';
import { LanguageService } from './language.service';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export const shopCategoriesResolver: ResolveFn<Category[]> = (): Observable<Category[]> => {
  const catalog = inject(CatalogService);
  const lang = inject(LanguageService).language();
  return catalog.listCategories(lang).pipe(catchError(() => of([])));
};
