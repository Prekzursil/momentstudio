import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { HomeComponent } from './home.component';
import { ApiService } from '../../core/api.service';
import { CatalogService } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';

describe('HomeComponent', () => {
  it('renders sections in CMS order', () => {
    const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['listProducts', 'listFeaturedCollections']);
    const recentlyViewed = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', ['list']);
    const auth = { isAuthenticated: () => false, role: () => 'user' } as unknown as AuthService;
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    api.get.and.callFake(<T>(url: string, _params?: unknown, _headers?: Record<string, string>) => {
      void _params;
      void _headers;
      if (url === '/content/home.sections') {
        return of({
          title: 'Home layout',
          body_markdown: '',
          meta: { sections: [{ id: 'featured_products', enabled: true }, { id: 'why', enabled: true }] },
          images: []
        } as unknown as T);
      }
      throw new Error(`Unexpected ApiService.get(${url})`);
    });

    catalog.listProducts.and.returnValue(
      of({
        items: [
          {
            id: 'p1',
            slug: 'p1',
            name: 'Product',
            base_price: 10,
            currency: 'USD',
            images: []
          }
        ],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 6 }
      })
    );
    catalog.listFeaturedCollections.and.returnValue(of([]));
    recentlyViewed.list.and.returnValue([]);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, HomeComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: CatalogService, useValue: catalog },
        { provide: RecentlyViewedService, useValue: recentlyViewed },
        { provide: AuthService, useValue: auth },
        { provide: MarkdownService, useValue: markdown }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        app: { tagline: 'art. handcrafted.' },
        home: {
          metaTitle: 'Home',
          metaDescription: 'Home',
          featured: 'Featured pieces',
          viewAll: 'View all',
          noFeatured: 'No featured products right now.',
          featuredError: { title: 'Err', copy: 'Err' },
          why: 'Why this starter',
          cards: { strictTitle: 'A', strict: 'A', tokensTitle: 'B', tokens: 'B', primitivesTitle: 'C', primitives: 'C', shellTitle: 'D', shell: 'D' }
        },
        shop: { retry: 'Retry' }
      },
      true
    );
    translate.use('en');

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();

    const h2s = Array.from(fixture.nativeElement.querySelectorAll('h2') as NodeListOf<HTMLElement>).map((el) =>
      (el.textContent || '').trim()
    );
    expect(h2s).toEqual(['Featured pieces', 'Why this starter']);
  });
});
