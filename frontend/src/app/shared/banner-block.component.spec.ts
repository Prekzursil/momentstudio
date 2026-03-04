import { BannerBlockComponent } from './banner-block.component';

describe('BannerBlockComponent', () => {
  function createComponent(): BannerBlockComponent {
    const component = new BannerBlockComponent();
    component.slide = {
      variant: 'full',
      headline: 'Headline',
      subheadline: 'Sub',
      cta_label: 'Explore',
      cta_url: '/shop',
      image_url: 'assets/home/banner_image.jpeg',
      alt: 'Banner',
      text_style: 'light',
      size: 'M',
      focal_x: 50,
      focal_y: 50,
    } as any;
    return component;
  }

  it('detects internal urls and trims image url values', () => {
    const component = createComponent();

    expect(component.isInternalUrl('/shop')).toBeTrue();
    expect(component.isInternalUrl(' /shop ')).toBeTrue();
    expect(component.isInternalUrl('//cdn.example.com')).toBeFalse();
    expect(component.isInternalUrl('https://example.com')).toBeFalse();
    expect(component.imageUrl()).toBe('assets/home/banner_image.jpeg');
  });

  it('builds optimized srcsets only for optimized banner asset names', () => {
    const component = createComponent();

    expect(component.useOptimizedAsset()).toBeTrue();
    expect(component.optimizedSrcset('avif')).toContain('banner_image-640.avif 640w');
    expect(component.optimizedSrcset('webp')).toContain('banner_image-960.webp 960w');
    expect(component.optimizedSrcset('jpg')).toContain('assets/home/banner_image.jpeg 1280w');

    component.slide.image_url = '/images/custom.jpg';
    expect(component.useOptimizedAsset()).toBeFalse();
    expect(component.optimizedSrcset('jpg')).toBe('');
  });

  it('computes layout, focal and text style classes for all size tokens', () => {
    const component = createComponent();

    component.slide.size = 'S';
    expect(component.imageClass()).toContain('aspect-[16/8]');
    expect(component.fullImageClass()).toContain('aspect-[16/5]');

    component.slide.size = 'L';
    expect(component.imageClass()).toContain('aspect-[5/4]');
    expect(component.fullImageClass()).toContain('aspect-[16/7]');

    component.slide.size = 'invalid' as any;
    expect(component.imageClass()).toContain('aspect-video');
    expect(component.fullImageClass()).toContain('aspect-video');

    component.slide.focal_x = 999 as any;
    component.slide.focal_y = -5 as any;
    expect(component.focalPosition()).toBe('100% 0%');

    component.slide.text_style = 'light' as any;
    expect(component.overlayClass()).toContain('from-slate-900/70');
    expect(component.textClass()).toBe('text-white');
    expect(component.subTextClass()).toBe('text-slate-100');

    component.slide.text_style = 'dark' as any;
    expect(component.overlayClass()).toContain('from-white/80');
    expect(component.textClass()).toContain('text-slate-900');
    expect(component.subTextClass()).toContain('text-slate-700');
    expect(component.wrapperClass()).toBe('');
    expect(component.splitSizes()).toContain('680px');
    expect(component.fullSizes()).toContain('1152px');
  });
});
