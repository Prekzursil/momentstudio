import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU blog-copy-scroll-text — copyShareLink / scrollToTop / hasMeaningfulArticleText. */
describe('BlogPostComponent copy/scroll/text helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    (cmp as any).bodyHtml = signal('<p>' + 'x'.repeat(120) + '</p>');
    (cmp as any).buildShareUrl = () => 'https://example.test/p';
    (cmp as any).translate = { instant: (k: string) => k };
    (cmp as any).toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
    };
    Object.assign(cmp as any, overrides);
    return cmp;
  }

  it('hasMeaningfulArticleText requires ~100 chars of stripped text', () => {
    const ok = createCmp();
    expect(ok.hasMeaningfulArticleText()).toBe(true);
    const short = createCmp();
    (short as any).bodyHtml = signal('<p>short</p>');
    expect(short.hasMeaningfulArticleText()).toBe(false);
  });

  it('scrollToTop smooth-scrolls the window to y=0', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const cmp = createCmp();
    (cmp as any).document = { defaultView: { scrollTo } };
    cmp.scrollToTop();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('copyShareLink copies via clipboard and toasts success', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    const cmp = createCmp();
    (cmp as any).document = {
      defaultView: { navigator: { clipboard: { writeText } } },
    };
    cmp.copyShareLink();
    expect(writeText).toHaveBeenCalledWith('https://example.test/p');
    await Promise.resolve();
    expect((cmp as any).toast.success).toHaveBeenCalled();
  });
});
