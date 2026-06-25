import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Slide } from './page-blocks';
import { BannerBlockComponent } from './banner-block.component';

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    variant: 'split',
    headline: 'Title',
    subheadline: 'Sub',
    image_url: '',
    cta_label: '',
    cta_url: '',
    alt: '',
    size: 'M',
    text_style: 'dark',
    ...overrides,
  } as Slide;
}

describe('BannerBlockComponent', () => {
  let fixture: ComponentFixture<BannerBlockComponent>;
  let component: BannerBlockComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BannerBlockComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(BannerBlockComponent);
    component = fixture.componentInstance;
  });

  it('creates and renders a split variant placeholder when no image', () => {
    component.slide = makeSlide();
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Banner image slot');
  });

  it('renders the full variant', () => {
    component.slide = makeSlide({ variant: 'full' });
    component.tagline = 'TAG';
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('TAG');
  });

  describe('isInternalUrl', () => {
    it('detects internal paths', () => {
      expect(component.isInternalUrl('/shop')).toBe(true);
    });

    it('rejects external, protocol-relative, and empty urls', () => {
      expect(component.isInternalUrl('https://x.com')).toBe(false);
      expect(component.isInternalUrl('//x.com')).toBe(false);
      expect(component.isInternalUrl('')).toBe(false);
      expect(component.isInternalUrl(null)).toBe(false);
    });
  });

  it('wrapperClass is empty', () => {
    component.slide = makeSlide();
    expect(component.wrapperClass()).toBe('');
  });

  describe('imageUrl', () => {
    it('trims the slide image url', () => {
      component.slide = makeSlide({ image_url: '  /a.png ' });
      expect(component.imageUrl()).toBe('/a.png');
    });

    it('returns empty when slide is missing the url', () => {
      component.slide = makeSlide({ image_url: undefined as never });
      expect(component.imageUrl()).toBe('');
    });

    it('returns empty when the slide itself is absent', () => {
      component.slide = undefined as never;
      expect(component.imageUrl()).toBe('');
    });
  });

  describe('useOptimizedAsset / optimizedSrcset', () => {
    it('recognizes the jpeg fallback asset', () => {
      component.slide = makeSlide({ image_url: '/assets/home/banner_image.jpeg' });
      expect(component.useOptimizedAsset()).toBe(true);
    });

    it('recognizes the prefixed optimized asset', () => {
      component.slide = makeSlide({ image_url: 'assets/home/banner_image-640.jpg' });
      expect(component.useOptimizedAsset()).toBe(true);
    });

    it('returns false for arbitrary images', () => {
      component.slide = makeSlide({ image_url: '/other.png' });
      expect(component.useOptimizedAsset()).toBe(false);
      expect(component.optimizedSrcset('avif')).toBe('');
    });

    it('returns false when there is no image url (normalizeAssetUrl empty path)', () => {
      // An empty image url exercises the `url || ''` fallback in normalizeAssetUrl.
      component.slide = makeSlide({ image_url: '' });
      expect(component.useOptimizedAsset()).toBe(false);
    });

    it('builds srcsets including the jpeg fallback at 1280', () => {
      component.slide = makeSlide({ image_url: 'assets/home/banner_image.jpeg' });
      const jpg = component.optimizedSrcset('jpg');
      expect(jpg).toContain('banner_image-640.jpg 640w');
      expect(jpg).toContain('banner_image.jpeg 1280w');
      const avif = component.optimizedSrcset('avif');
      expect(avif).toContain('banner_image-1280.avif 1280w');
      const webp = component.optimizedSrcset('webp');
      expect(webp).toContain('banner_image-960.webp 960w');
    });
  });

  it('exposes fixed sizes strings', () => {
    component.slide = makeSlide();
    expect(component.splitSizes()).toContain('680px');
    expect(component.fullSizes()).toContain('1152px');
  });

  describe('imageClass / fullImageClass', () => {
    it('maps small / medium / large sizes', () => {
      component.slide = makeSlide({ size: 'S' });
      expect(component.imageClass()).toContain('aspect-[16/8]');
      expect(component.fullImageClass()).toContain('aspect-[16/5]');

      component.slide = makeSlide({ size: 'L' });
      expect(component.imageClass()).toContain('aspect-[5/4]');
      expect(component.fullImageClass()).toContain('aspect-[16/7]');

      component.slide = makeSlide({ size: 'M' });
      expect(component.imageClass()).toContain('aspect-video');
      expect(component.fullImageClass()).toContain('aspect-video');
    });

    it('defaults to medium when size is unknown', () => {
      component.slide = makeSlide({ size: 'XL' as never });
      expect(component.imageClass()).toContain('aspect-video');
    });
  });

  describe('focalPosition', () => {
    it('uses defaults when focal points are missing', () => {
      component.slide = makeSlide({ focal_x: undefined, focal_y: undefined });
      expect(component.focalPosition()).toBe('50% 50%');
    });

    it('clamps focal points into the 0-100 range', () => {
      component.slide = makeSlide({ focal_x: -10, focal_y: 250 });
      expect(component.focalPosition()).toBe('0% 100%');
    });
  });

  describe('overlay / text classes', () => {
    it('uses light styling', () => {
      component.slide = makeSlide({ text_style: 'light' });
      expect(component.overlayClass()).toContain('from-slate-900/70');
      expect(component.textClass()).toBe('text-white');
      expect(component.subTextClass()).toBe('text-slate-100');
    });

    it('uses dark styling', () => {
      component.slide = makeSlide({ text_style: 'dark' });
      expect(component.overlayClass()).toContain('from-white/80');
      expect(component.textClass()).toContain('text-slate-900');
      expect(component.subTextClass()).toContain('text-slate-700');
    });
  });

  function render(slide: Slide): HTMLElement {
    // Destroy the beforeEach fixture so its (possibly slide-less) view is not
    // refreshed by a later change-detection pass.
    fixture.destroy();
    const f = TestBed.createComponent(BannerBlockComponent);
    f.componentInstance.slide = slide;
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders an internal CTA as a router link', () => {
    const el = render(makeSlide({ image_url: '/pic.png', cta_label: 'Go', cta_url: '/shop' }));
    expect(el.querySelector('app-button')).toBeTruthy();
  });

  it('renders an external CTA as a href', () => {
    const el = render(makeSlide({ cta_label: 'Out', cta_url: 'https://x.com' }));
    expect(el.querySelector('app-button')).toBeTruthy();
  });

  it('renders an optimized picture element for the split variant', () => {
    const el = render(makeSlide({ variant: 'split', image_url: 'assets/home/banner_image.jpeg' }));
    expect(el.querySelector('picture')).toBeTruthy();
  });

  it('renders a plain image for the full variant', () => {
    const el = render(makeSlide({ variant: 'full', image_url: '/plain.png' }));
    expect(el.querySelector('img')).toBeTruthy();
  });

  it('renders the full optimized picture and a split plain image', () => {
    const full = render(makeSlide({ variant: 'full', image_url: 'assets/home/banner_image.jpeg' }));
    expect(full.querySelector('picture')).toBeTruthy();

    const split = render(makeSlide({ variant: 'split', image_url: '/plain.png' }));
    expect(split.querySelector('img')).toBeTruthy();
  });
});
