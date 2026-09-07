import { BlogPostComponent } from './blog-post.component';

/** Golden WU tip orphan — scrollToTop. */
describe('BlogPostComponent scrollToTop (golden WU)', () => {
  it('scrolls window to top when defaultView exists', () => {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    const scrollTo = jasmine.createSpy('scrollTo');
    Object.assign(cmp as any, { document: { defaultView: { scrollTo } } });
    cmp.scrollToTop();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('no-ops when defaultView is missing', () => {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, { document: {} });
    expect(() => cmp.scrollToTop()).not.toThrow();
  });
});
