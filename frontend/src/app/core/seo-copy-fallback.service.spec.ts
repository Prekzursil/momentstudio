import { TestBed } from '@angular/core/testing';

import { SeoCopyFallbackService } from './seo-copy-fallback.service';

describe('SeoCopyFallbackService', () => {
  let service: SeoCopyFallbackService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SeoCopyFallbackService] });
    service = TestBed.inject(SeoCopyFallbackService);
  });

  describe('pageIntro', () => {
    it('uses the provided title (en)', () => {
      expect(service.pageIntro('en', 'Returns Policy')).toContain('Returns Policy');
    });

    it('falls back to a generic title (en)', () => {
      expect(service.pageIntro('en', '   ')).toContain('this page');
    });

    it('uses the romanian template and fallback', () => {
      expect(service.pageIntro('ro', 'Politica')).toContain('Politica');
      expect(service.pageIntro('ro', '')).toContain('aceasta pagina');
    });
  });

  describe('productIntro', () => {
    it('includes category when present (en)', () => {
      expect(service.productIntro('en', 'Mug', 'Drinkware')).toContain('Drinkware category');
    });

    it('omits category when absent (en)', () => {
      const copy = service.productIntro('en', 'Mug', null);
      expect(copy).toContain('Mug');
      expect(copy).not.toContain('category');
    });

    it('handles romanian with and without category', () => {
      expect(service.productIntro('ro', 'Cana', 'Vesela')).toContain('categoria Vesela');
      expect(service.productIntro('ro', 'Cana')).toContain('Cana');
    });

    it('falls back to a generic product name', () => {
      expect(service.productIntro('en', '')).toContain('this product');
      expect(service.productIntro('ro', '')).toContain('acest produs');
    });
  });

  describe('blogListIntro', () => {
    it('prefers series over tag (en)', () => {
      expect(service.blogListIntro('en', 'tagx', 'Series A')).toContain('Series A series');
    });

    it('uses tag when no series (en)', () => {
      expect(service.blogListIntro('en', 'tagx')).toContain('tagged tagx');
    });

    it('uses the plain default when neither is present (en)', () => {
      expect(service.blogListIntro('en')).toContain('Browse recent posts');
    });

    it('handles romanian series, tag, and default', () => {
      expect(service.blogListIntro('ro', 'eticheta', 'Seria X')).toContain('seria Seria X');
      expect(service.blogListIntro('ro', 'eticheta')).toContain('etichetate eticheta');
      expect(service.blogListIntro('ro')).toContain('Exploreaza articole noi');
    });
  });

  describe('blogPostIntro', () => {
    it('uses the title and fallback in both languages', () => {
      expect(service.blogPostIntro('en', 'My Post')).toContain('My Post');
      expect(service.blogPostIntro('en', '')).toContain('this article');
      expect(service.blogPostIntro('ro', 'Articol')).toContain('Articol');
      expect(service.blogPostIntro('ro', '')).toContain('acest articol');
    });
  });
});
