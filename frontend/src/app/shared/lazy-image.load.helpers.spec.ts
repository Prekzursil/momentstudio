import { LazyImageDirective } from './lazy-image.directive';

/** Golden WU shared-lazy-image-load — eager load when observer missing. */
describe('LazyImageDirective ngOnInit (golden WU)', () => {
  it('loads image immediately when IntersectionObserver is unavailable', () => {
    const orig = (window as any).IntersectionObserver;
    delete (window as any).IntersectionObserver;
    const el = document.createElement('img');
    const renderer = {
      setAttribute: jasmine.createSpy('setAttribute'),
      addClass: jasmine.createSpy('addClass'),
    };
    const dir = Object.create(LazyImageDirective.prototype) as LazyImageDirective;
    Object.assign(dir as any, {
      el: { nativeElement: el },
      renderer,
      src: 'hero.jpg',
      alt: 'Hero',
    });
    dir.ngOnInit();
    expect(renderer.setAttribute).toHaveBeenCalledWith(el, 'src', 'hero.jpg');
    expect(renderer.setAttribute).toHaveBeenCalledWith(el, 'alt', 'Hero');
    (window as any).IntersectionObserver = orig;
  });

  it('no-ops when src is empty', () => {
    const dir = Object.create(LazyImageDirective.prototype) as LazyImageDirective;
    Object.assign(dir as any, {
      el: { nativeElement: document.createElement('img') },
      renderer: { setAttribute: jasmine.createSpy(), addClass: jasmine.createSpy() },
      src: '',
      alt: '',
    });
    dir.ngOnInit();
    expect((dir as any).renderer.setAttribute).not.toHaveBeenCalled();
  });
});
