import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU blog-cover-lightbox — coverImageClass / openLightbox / nextLightbox. */
describe('BlogPostComponent cover/lightbox helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    (cmp as any).galleryImages = signal([
      { src: 'a.jpg', alt: 'a' },
      { src: 'b.jpg', alt: 'b' },
    ]);
    (cmp as any).lightboxIndex = signal<number | null>(null);
    (cmp as any).previousBodyOverflow = null;
    (cmp as any).lightboxKeyListener = () => undefined;
    (cmp as any).document = {
      defaultView: { addEventListener: jasmine.createSpy('addEventListener') },
      body: { style: { overflow: '' } },
    };
    Object.assign(cmp as any, overrides);
    return cmp;
  }

  it('coverImageClass switches contain vs default cover classes', () => {
    const cmp = createCmp();
    expect(cmp.coverImageClass('contain')).toContain('object-contain');
    expect(cmp.coverImageClass('cover')).toContain('object-cover');
    expect(cmp.coverImageClass(null)).toContain('object-cover');
  });

  it('openLightbox clamps index', () => {
    const cmp = createCmp();
    cmp.openLightbox(-3);
    expect((cmp as any).lightboxIndex()).toBe(0);
    cmp.openLightbox(99);
    expect((cmp as any).lightboxIndex()).toBe(1);
  });

  it('nextLightbox wraps the gallery', () => {
    const cmp = createCmp();
    (cmp as any).lightboxIndex.set(1);
    const ev = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;
    cmp.nextLightbox(ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect((cmp as any).lightboxIndex()).toBe(0);
  });
});
