import { BlogPostComponent } from './blog-post.component';
import { formatIdentity } from '../../shared/user-identity';

/** Golden WU blog-canedit-lang-author — canEditBlog / activeLang / authorLabel. */
describe('BlogPostComponent canEditBlog / activeLang / authorLabel (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => false },
      translate: { currentLang: 'en', instant: (k: string) => k },
      ...overrides,
    });
    return cmp;
  }

  it('canEditBlog mirrors storefrontAdminMode.enabled()', () => {
    expect(createCmp({ storefrontAdminMode: { enabled: () => true } }).canEditBlog()).toBe(true);
    expect(createCmp({ storefrontAdminMode: { enabled: () => false } }).canEditBlog()).toBe(false);
  });

  it('activeLang returns ro only when translate.currentLang is ro', () => {
    expect(
      createCmp({ translate: { currentLang: 'ro', instant: (k: string) => k } }).activeLang(),
    ).toBe('ro');
    expect(
      createCmp({ translate: { currentLang: 'en', instant: (k: string) => k } }).activeLang(),
    ).toBe('en');
    expect(
      createCmp({ translate: { currentLang: 'fr', instant: (k: string) => k } }).activeLang(),
    ).toBe('en');
  });

  it('authorLabel delegates to formatIdentity with anonymous fallback', () => {
    const author = { name: 'Ada', username: 'ada' } as any;
    const cmp = createCmp();
    expect(cmp.authorLabel(author)).toBe(formatIdentity(author, 'blog.comments.anonymous'));
    expect(cmp.authorLabel(null)).toBe(formatIdentity(null, 'blog.comments.anonymous'));
  });
});
