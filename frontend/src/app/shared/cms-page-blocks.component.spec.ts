import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '../core/auth.service';
import { CatalogService } from '../core/catalog.service';
import { NewsletterService } from '../core/newsletter.service';
import { SupportService } from '../core/support.service';
import { CmsPageBlocksComponent } from './cms-page-blocks.component';
import { PageBlock, Slide } from './page-blocks';

function slide(): Slide {
  return {
    image_url: '/s.jpg',
    variant: 'full',
    size: 'M',
    text_style: 'light',
  };
}

describe('CmsPageBlocksComponent', () => {
  let fixture: ComponentFixture<CmsPageBlocksComponent>;
  let component: CmsPageBlocksComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CmsPageBlocksComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { user: () => null, isAuthenticated: () => false },
        },
        {
          provide: CatalogService,
          useValue: {
            listProducts: () => of({ items: [] }),
            listFeaturedCollections: () => of([]),
            getProduct: () => of(null),
          },
        },
        { provide: SupportService, useValue: { createSubmission: () => of({}) } },
        { provide: NewsletterService, useValue: { subscribe: () => of({}) } },
      ],
    });
    fixture = TestBed.createComponent(CmsPageBlocksComponent);
    component = fixture.componentInstance;
  });

  function render(blocks: PageBlock[]): void {
    component.blocks = blocks;
    fixture.detectChanges();
  }

  it('renders a text block with a title', () => {
    render([{ key: 't', type: 'text', enabled: true, title: 'Heading', body_html: '<p>Hi</p>' }]);
    expect(fixture.nativeElement.textContent).toContain('Heading');
    expect(fixture.nativeElement.innerHTML).toContain('Hi');
  });

  it('renders a cta block with an external link', () => {
    render([
      {
        key: 'c',
        type: 'cta',
        enabled: true,
        body_html: '',
        cta_label: 'Go',
        cta_url: 'https://example.com',
        cta_new_tab: true,
      },
    ]);
    const anchor = fixture.debugElement.query(By.css('app-button a'));
    expect(anchor.nativeElement.getAttribute('href')).toBe('https://example.com');
    expect(anchor.nativeElement.getAttribute('target')).toBe('_blank');
  });

  it('renders a cta block with an internal routerLink', () => {
    render([
      { key: 'c', type: 'cta', enabled: true, body_html: '', cta_label: 'Go', cta_url: '/shop' },
    ]);
    expect(fixture.debugElement.query(By.css('app-button'))).toBeTruthy();
  });

  it('renders a product grid block', () => {
    render([
      {
        key: 'p',
        type: 'product_grid',
        enabled: true,
        title: 'Picks',
        source: 'category',
        limit: 6,
        category_slug: 'rings',
      },
    ]);
    expect(fixture.debugElement.query(By.css('app-cms-product-grid-block'))).toBeTruthy();
  });

  it('renders a form block', () => {
    render([{ key: 'f', type: 'form', enabled: true, form_type: 'contact', topic: 'contact' }]);
    expect(fixture.debugElement.query(By.css('app-cms-form-block'))).toBeTruthy();
  });

  it('renders an faq block', () => {
    render([
      {
        key: 'q',
        type: 'faq',
        enabled: true,
        items: [{ question: 'Why?', answer_html: '<p>Because</p>' }],
      },
    ]);
    expect(fixture.nativeElement.textContent).toContain('Why?');
  });

  it('renders a testimonials block with author and role', () => {
    render([
      {
        key: 'te',
        type: 'testimonials',
        enabled: true,
        items: [{ quote_html: '<p>Great</p>', author: 'Ana', role: 'Buyer' }],
      },
    ]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ana');
    expect(text).toContain('Buyer');
  });

  it('renders an image block with a link and caption', () => {
    render([
      {
        key: 'i',
        type: 'image',
        enabled: true,
        url: '/a.jpg',
        link_url: 'https://example.com',
        caption: 'A caption',
        focal_x: 20,
        focal_y: 80,
      },
    ]);
    expect(fixture.debugElement.query(By.css('a[href="https://example.com"] img'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('A caption');
  });

  it('renders a plain image block without a link', () => {
    render([{ key: 'i', type: 'image', enabled: true, url: '/a.jpg', focal_x: 50, focal_y: 50 }]);
    const img = fixture.debugElement.query(By.css('img'));
    expect(img.nativeElement.getAttribute('src')).toBe('/a.jpg');
  });

  it('renders a gallery block with captions', () => {
    render([
      {
        key: 'g',
        type: 'gallery',
        enabled: true,
        images: [{ url: '/g.jpg', caption: 'Pic', focal_x: 10, focal_y: 10 }],
      },
    ]);
    expect(fixture.nativeElement.textContent).toContain('Pic');
  });

  it('renders a banner block', () => {
    render([{ key: 'b', type: 'banner', enabled: true, slide: slide() }]);
    expect(fixture.debugElement.query(By.css('app-banner-block'))).toBeTruthy();
  });

  it('renders a carousel block', () => {
    render([
      {
        key: 'ca',
        type: 'carousel',
        enabled: true,
        slides: [slide()],
        settings: {
          autoplay: false,
          interval_ms: 5000,
          show_dots: true,
          show_arrows: true,
          pause_on_hover: true,
        },
      },
    ]);
    expect(fixture.debugElement.query(By.css('app-carousel-block'))).toBeTruthy();
  });

  it('renders a columns block', () => {
    render([
      {
        key: 'co',
        type: 'columns',
        enabled: true,
        title: 'Cols',
        columns: [{ title: 'One', body_html: '<p>1</p>' }, { body_html: '<p>2</p>' }],
        columns_count: 2,
        breakpoint: 'md',
      },
    ]);
    expect(fixture.nativeElement.textContent).toContain('One');
  });

  it('detects external http(s) urls', () => {
    expect(component.isExternalHttpUrl('http://x.com')).toBeTrue();
    expect(component.isExternalHttpUrl('HTTPS://X.com')).toBeTrue();
    expect(component.isExternalHttpUrl('/internal')).toBeFalse();
    expect(component.isExternalHttpUrl(null)).toBeFalse();
    expect(component.isExternalHttpUrl(undefined)).toBeFalse();
  });

  it('clamps and defaults focal positions', () => {
    expect(component.focalPosition(undefined, undefined)).toBe('50% 50%');
    expect(component.focalPosition(-5, 150)).toBe('0% 100%');
    expect(component.focalPosition(40.6, 12.2)).toBe('41% 12%');
  });

  it('computes columns grid classes for each count and breakpoint', () => {
    expect(
      component.columnsGridClasses({
        key: 'x',
        type: 'columns',
        enabled: true,
        columns: [],
        columns_count: 3,
        breakpoint: 'lg',
      }),
    ).toContain('lg:grid-cols-3');
    expect(
      component.columnsGridClasses({
        key: 'x',
        type: 'columns',
        enabled: true,
        columns: [],
        columns_count: 2,
        breakpoint: 'sm',
      }),
    ).toContain('sm:grid-cols-2');
  });

  it('returns no grid classes for a non-columns block', () => {
    expect(
      component.columnsGridClasses({
        key: 't',
        type: 'text',
        enabled: true,
        body_html: '',
      } as PageBlock),
    ).toBe('');
  });
});
