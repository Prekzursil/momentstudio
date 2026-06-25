import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { CatalogService, Product } from '../core/catalog.service';
import { CmsProductGridBlockComponent } from './cms-product-grid-block.component';
import { PageProductGridBlock } from './page-blocks';

function product(id: string, slug = id): Product {
  return {
    id,
    slug,
    name: id,
    currency: 'RON',
    base_price: 10,
    images: [],
  } as unknown as Product;
}

describe('CmsProductGridBlockComponent', () => {
  let catalog: jasmine.SpyObj<CatalogService>;
  let fixture: ComponentFixture<CmsProductGridBlockComponent>;
  let component: CmsProductGridBlockComponent;

  function block(overrides: Partial<PageProductGridBlock>): PageProductGridBlock {
    return {
      type: 'product_grid',
      source: 'category',
      limit: 6,
      ...overrides,
    } as PageProductGridBlock;
  }

  beforeEach(() => {
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'listProducts',
      'listFeaturedCollections',
      'getProduct',
    ]);
    TestBed.configureTestingModule({
      imports: [CmsProductGridBlockComponent, TranslateModule.forRoot()],
      providers: [provideRouter([]), { provide: CatalogService, useValue: catalog }],
    });
    fixture = TestBed.createComponent(CmsProductGridBlockComponent);
    component = fixture.componentInstance;
  });

  it('loads category products', () => {
    catalog.listProducts.and.returnValue(of({ items: [product('a')] } as any));
    component.block = block({ source: 'category', category_slug: 'rings', limit: 3 });
    component.ngOnChanges();
    fixture.detectChanges();

    expect(catalog.listProducts).toHaveBeenCalledWith({ category_slug: 'rings', limit: 3 });
    expect(component.products().length).toBe(1);
    expect(component.loading()).toBeFalse();
  });

  it('clamps the limit between 1 and 24 and rounds it', () => {
    catalog.listProducts.and.returnValue(of({ items: [] } as any));
    component.block = block({ source: 'category', category_slug: 'rings', limit: 99 });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledWith({ category_slug: 'rings', limit: 24 });
  });

  it('defaults a non-finite limit to 6', () => {
    catalog.listProducts.and.returnValue(of({ items: [] } as any));
    component.block = block({
      source: 'category',
      category_slug: 'rings',
      limit: Number.NaN as unknown as number,
    });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledWith({ category_slug: 'rings', limit: 6 });
  });

  it('tolerates a missing items array from the catalog', () => {
    catalog.listProducts.and.returnValue(of({} as any));
    component.block = block({ source: 'category', category_slug: 'rings' });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.products()).toEqual([]);
  });

  it('loads a featured collection by slug', () => {
    catalog.listFeaturedCollections.and.returnValue(
      of([{ slug: 'spring', products: [product('a'), product('b'), product('c')] }] as any),
    );
    component.block = block({ source: 'collection', collection_slug: 'spring', limit: 2 });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.products().length).toBe(2);
  });

  it('returns an empty list when the collection is missing', () => {
    catalog.listFeaturedCollections.and.returnValue(of(null as any));
    component.block = block({ source: 'collection', collection_slug: 'none' });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.products()).toEqual([]);
  });

  it('loads manual product slugs and drops failures', () => {
    catalog.getProduct.and.callFake((slug: string) =>
      slug === 'bad' ? throwError(() => new Error('x')) : of(product(slug)),
    );
    component.block = block({ source: 'products', product_slugs: [' ok ', 'bad', ''] });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.products().map((p) => p.id)).toEqual(['ok']);
  });

  it('does nothing when no source criteria match', () => {
    component.block = block({ source: 'category', category_slug: '' });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.loading()).toBeFalse();
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('shows the error state and retries on demand', () => {
    catalog.listProducts.and.returnValue(throwError(() => new Error('down')));
    component.block = block({ source: 'category', category_slug: 'rings' });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.error()).toBeTrue();

    catalog.listProducts.and.returnValue(of({ items: [product('a')] } as any));
    fixture.debugElement.query(By.css('app-button')).componentInstance.action.emit();
    fixture.detectChanges();
    expect(component.error()).toBeFalse();
    expect(component.products().length).toBe(1);
  });

  it('tracks products by id, slug, then index', () => {
    expect(component.trackProduct(0, product('id1', 'slug1'))).toBe('id1');
    expect(component.trackProduct(1, { id: '', slug: 'slug2' } as Product)).toBe('slug2');
    expect(component.trackProduct(2, { id: '', slug: '' } as Product)).toBe('2');
  });

  it('defaults the limit to 6 when none is provided', () => {
    catalog.listProducts.and.returnValue(of({ items: [] } as any));
    component.block = block({
      source: 'category',
      category_slug: 'rings',
      limit: undefined as unknown as number,
    });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledWith({ category_slug: 'rings', limit: 6 });
  });

  it('returns early when load runs without a block', () => {
    component.block = undefined as unknown as PageProductGridBlock;
    expect(() => component.load()).not.toThrow();
    expect(component.loading()).toBeFalse();
  });

  it('unsubscribes on destroy', () => {
    catalog.listProducts.and.returnValue(of({ items: [] } as any));
    component.block = block({ source: 'category', category_slug: 'rings' });
    component.ngOnChanges();
    fixture.detectChanges();
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
