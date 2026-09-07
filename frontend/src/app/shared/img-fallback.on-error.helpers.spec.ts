import { ImgFallbackDirective } from './img-fallback.directive';

/** Golden WU shared-img-fallback-src — onError fallback arms. */
describe('ImgFallbackDirective onError (golden WU)', () => {
  it('applies fallback src once', () => {
    const img = document.createElement('img');
    img.src = 'broken.jpg';
    const dir = Object.create(ImgFallbackDirective.prototype) as ImgFallbackDirective;
    Object.assign(dir as any, { el: { nativeElement: img }, fallbackSrc: 'fallback.svg' });
    dir.onError();
    expect(img.src).toContain('fallback.svg');
    expect(img.dataset['fallbackApplied']).toBe('true');
  });

  it('no-ops without fallbackSrc', () => {
    const img = document.createElement('img');
    img.src = 'broken.jpg';
    const dir = Object.create(ImgFallbackDirective.prototype) as ImgFallbackDirective;
    Object.assign(dir as any, { el: { nativeElement: img }, fallbackSrc: undefined });
    dir.onError();
    expect(img.src).toContain('broken.jpg');
  });
});
