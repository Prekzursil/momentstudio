import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU blog-heading-scroll — scrollToHeading / scrollToTop. */
describe('BlogPostComponent heading/scroll helpers (golden WU)', () => {
  function createCmp() {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    (cmp as any).activeHeadingId = signal<string | null>(null);
    return cmp;
  }

  it('scrollToTop smooth-scrolls the window to y=0', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const cmp = createCmp();
    (cmp as any).document = { defaultView: { scrollTo } };
    cmp.scrollToTop();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('scrollToHeading smooth-scrolls to the target offset and activates the heading', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const replaceState = jasmine.createSpy('replaceState');
    const target = { getBoundingClientRect: () => ({ top: 200 }) };
    const cmp = createCmp();
    (cmp as any).document = {
      getElementById: (id: string) => (id === 'h1' ? target : null),
      defaultView: {
        scrollTo,
        scrollY: 100,
        history: { replaceState },
        location: { pathname: '/blog/p', search: '' },
      },
    };
    const ev = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    cmp.scrollToHeading(ev, 'h1');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalled();
    expect((cmp as any).activeHeadingId()).toBe('h1');
  });
});
