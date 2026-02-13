import { TestBed } from '@angular/core/testing';
import { ShopComponent } from './shop.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Title, Meta } from '@angular/platform-browser';
import { of } from 'rxjs';
import { CatalogService } from '../../core/catalog.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ToastService } from '../../core/toast.service';
import { type Observable } from 'rxjs';

describe('ShopComponent i18n meta', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);

    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: CatalogService, useValue: { listProducts: () => of({ items: [], meta: null }), listCategories: () => of([]) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {}, queryParams: {} }, paramMap: of(convertToParamMap({})), queryParams: of({}) } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: ToastService, useValue: { error: () => {} } }
      ]
    });
  });

  it('updates meta tags based on current language', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { shop: { metaTitle: 'EN title', metaDescription: 'EN desc' } },
      true
    );
    translate.setTranslation(
      'ro',
      { shop: { metaTitle: 'RO title', metaDescription: 'RO desc' } },
      true
    );
    translate.use('en');

    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('EN title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'EN desc' });

    meta.updateTag.calls.reset();
    title.setTitle.calls.reset();
    translate.use('ro');
    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('RO title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'RO desc' });
  });

  it('ignores stale product list responses when multiple loads overlap', () => {
    const catalog = {
      listCategories: () => of([]),
      listProducts: (() => {
        let call = 0;
        return () => {
          call += 1;
          const payload =
            call === 1
              ? { items: [{ id: 'old', slug: 'old', name: 'Old', base_price: 1, currency: 'RON' }], meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 } }
              : { items: [{ id: 'new', slug: 'new', name: 'New', base_price: 1, currency: 'RON' }], meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 } };
          return of(payload);
        };
      })() as unknown as (params: any) => Observable<any>
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: CatalogService, useValue: catalog },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {}, queryParams: {} }, paramMap: of(convertToParamMap({})), queryParams: of({}) } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: ToastService, useValue: { error: () => {} } }
      ]
    });

    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    // Force two sequential loads; only the last should win.
    cmp.loadProducts(false);
    cmp.loadProducts(false);

    expect(cmp.products.length).toBe(1);
    expect(cmp.products[0].id).toBe('new');
  });
});
