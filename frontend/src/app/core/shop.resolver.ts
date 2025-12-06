import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { CatalogService, Category } from './catalog.service';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export const shopCategoriesResolver: ResolveFn<Category[]> = (): Observable<Category[]> => {
  const catalog = inject(CatalogService);
  return catalog.listCategories().pipe(catchError(() => of([])));
};
