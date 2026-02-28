import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AdminComponent } from './admin.component';

describe('AdminComponent coverage helpers', () => {
  function createComponent() {
    const route = {
      snapshot: { data: { section: 'home' }, queryParams: {} },
      data: of({ section: 'home' }),
      queryParams: of({})
    } as unknown as ActivatedRoute;

    const admin = jasmine.createSpyObj('AdminService', [
      'content',
      'products',
      'coupons',
      'lowStock',
      'getContent',
      'updateCategory'
    ]);
    admin.content.and.returnValue(of([]));
    admin.products.and.returnValue(of([]));
    admin.coupons.and.returnValue(of([]));
    admin.lowStock.and.returnValue(of([]));
    admin.getContent.and.returnValue(of({ title: '', body_markdown: '' }));

    const auth = {
      role: jasmine.createSpy('role').and.returnValue('owner'),
      user: jasmine.createSpy('user').and.returnValue({ id: 'user-1' })
    };

    const cmsPrefs = {
      mode: jasmine.createSpy('mode').and.returnValue('basic'),
      previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
      previewLayout: jasmine.createSpy('previewLayout').and.returnValue('split')
    };

    const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

    const translate = {
      currentLang: 'en',
      instant: (key: string) => key
    };

    const component = new AdminComponent(
      route,
      admin as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      auth as any,
      cmsPrefs as any,
      toast as any,
      translate as any,
      { render: (value: string) => value } as any,
      {
        bypassSecurityTrustHtml: (value: string) => value,
        bypassSecurityTrustResourceUrl: (value: string) => value
      } as unknown as DomSanitizer
    );

    return { component, admin, auth, cmsPrefs, toast };
  }

  it('normalizes sections and returns revision title keys for mapped values', () => {
    const { component } = createComponent();

    expect((component as any).normalizeSection('blog')).toBe('blog');
    expect((component as any).normalizeSection('unsupported')).toBe('home');

    component.pagesRevisionKey = 'page.privacy-policy';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.privacy');
    component.pagesRevisionKey = 'page.unknown';
    expect(component.pagesRevisionTitleKey()).toBeUndefined();

    component.settingsRevisionKey = 'seo.blog';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.seo.title');
    component.settingsRevisionKey = 'site.assets';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.assets.title');
    component.settingsRevisionKey = 'site.unknown';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.content.revisions.title');
  });

  it('applies edit query for blog and pages only when a new valid key is provided', () => {
    const { component } = createComponent();

    const loadBlogEditor = spyOn<any>(component, 'loadBlogEditor').and.stub();
    const onPageBlocksKeyChange = spyOn<any>(component, 'onPageBlocksKeyChange').and.stub();

    component.selectedBlogKey = 'blog.existing';
    (component as any).applyContentEditQuery('blog', { edit: 'existing' });
    expect(loadBlogEditor).not.toHaveBeenCalled();

    (component as any).applyContentEditQuery('blog', { edit: 'new-post' });
    expect(loadBlogEditor).toHaveBeenCalledWith('blog.new-post');

    (component as any).applyContentEditQuery('pages', { edit: 'contact' });
    expect(onPageBlocksKeyChange).toHaveBeenCalledWith('page.contact');

    onPageBlocksKeyChange.calls.reset();
    (component as any).applyContentEditQuery('pages', { edit: 'page.' });
    expect(onPageBlocksKeyChange).not.toHaveBeenCalled();
  });

  it('maps preview classes and viewport widths from cms preference device', () => {
    const { component, cmsPrefs } = createComponent();

    (cmsPrefs.previewDevice as jasmine.Spy).and.returnValues('mobile', 'tablet', 'desktop', 'mobile', 'tablet', 'desktop');

    expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[390px]');
    expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[768px]');
    expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[1024px]');

    expect(component.cmsPreviewViewportWidth()).toBe(390);
    expect(component.cmsPreviewViewportWidth()).toBe(768);
    expect(component.cmsPreviewViewportWidth()).toBe(1024);
  });

  it('tracks expected content versions and handles 409 content conflict', () => {
    const { component, toast } = createComponent();

    (component as any).rememberContentVersion('blog.post-1', { version: 7 });
    expect((component as any).expectedVersion('blog.post-1')).toBe(7);

    const withExpected = (component as any).withExpectedVersion('blog.post-1', { status: 'draft' });
    expect(withExpected.expected_version).toBe(7);

    const withoutExpected = (component as any).withExpectedVersion('blog.unknown', { status: 'draft' }) as any;
    expect(withoutExpected.expected_version).toBeUndefined();

    const reload = jasmine.createSpy('reload');
    expect((component as any).handleContentConflict({ status: 400 }, 'blog.post-1', reload)).toBeFalse();
    expect(reload).not.toHaveBeenCalled();

    expect((component as any).handleContentConflict({ status: 409 }, 'blog.post-1', reload)).toBeTrue();
    expect(reload).toHaveBeenCalled();
    expect((component as any).expectedVersion('blog.post-1')).toBeUndefined();
    expect(toast.error).toHaveBeenCalled();
  });

  it('rejects unsafe record keys and unsafe page record keys', () => {
    const { component } = createComponent();

    expect((component as any).safeRecordKey('__proto__', 'fallback')).toBe('fallback');
    expect((component as any).safeRecordKey('valid.key-1', 'fallback')).toBe('valid.key-1');

    expect((component as any).safePageRecordKey('page.__proto__')).toBe('page.about');
    expect((component as any).safePageRecordKey('page.contact')).toBe('page.contact');
  });

  it('builds category parent options without descendants and keeps alphabetical ordering', () => {
    const { component } = createComponent();

    component.categories = [
      { id: 'root', slug: 'root', name: 'Root', parent_id: null } as any,
      { id: 'child-a', slug: 'child-a', name: 'Charlie', parent_id: 'root' } as any,
      { id: 'child-b', slug: 'child-b', name: 'Bravo', parent_id: 'child-a' } as any,
      { id: 'sibling', slug: 'sibling', name: 'Alpha', parent_id: null } as any
    ];

    const options = component.categoryParentOptions(component.categories[0] as any);
    expect(options.map((c) => c.id)).toEqual(['sibling']);

    expect(component.categoryParentLabel({ parent_id: null } as any)).toBe('adminUi.categories.parentNone');
    expect(component.categoryParentLabel({ parent_id: 'missing' } as any)).toBe('adminUi.categories.parentNone');
  });

  it('interprets pinned slots and sorts pinned blog posts by slot then recency', () => {
    const { component } = createComponent();

    expect((component as any).pinnedSlotFromMeta({ pinned: true, pin_order: '2.9' })).toBe(2);
    expect((component as any).pinnedSlotFromMeta({ pinned: 0, pin_order: 4 })).toBeNull();
    expect((component as any).pinnedSlotFromMeta(null)).toBeNull();

    component.contentBlocks = [
      {
        key: 'blog.alpha',
        meta: { pinned: true, pin_order: 2 },
        published_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z'
      } as any,
      {
        key: 'blog.beta',
        meta: { pinned: '1', pin_order: 1 },
        published_at: '2024-01-05T00:00:00Z',
        updated_at: '2024-01-06T00:00:00Z'
      } as any,
      {
        key: 'blog.gamma',
        meta: { pinned: 'yes', pin_order: 2 },
        published_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z'
      } as any,
      { key: 'home.hero', meta: { pinned: true, pin_order: 1 } } as any
    ];

    expect(component.blogPinnedPosts().map((post) => post.key)).toEqual(['blog.beta', 'blog.gamma', 'blog.alpha']);
  });

  it('builds blog seo previews, detects issues, and generates public/og urls', () => {
    const { component } = createComponent();

    component.selectedBlogKey = 'blog.coverage-target';
    component.blogEditLang = 'en';
    component.blogForm.title = 'Tiny';
    component.blogForm.body_markdown = 'word '.repeat(220);
    component.blogForm.status = 'draft';
    component.blogMeta = {};
    component.blogPreviewToken = null;
    (component as any).blogSeoSnapshots.ro = { title: 'Titlu', body_markdown: 'Continut' };

    expect(component.blogSeoHasContent('en')).toBeTrue();
    expect(component.blogSeoHasContent('ro')).toBeTrue();
    expect(component.blogSeoTitleFull('en')).toBe('Tiny | momentstudio');

    const titlePreview = component.blogSeoTitlePreview('en');
    const descriptionPreview = component.blogSeoDescriptionPreview('en');
    expect(titlePreview.length).toBeLessThanOrEqual(62);
    expect(descriptionPreview.length).toBeLessThanOrEqual(160);

    const issues = component.blogSeoIssues('en').map((issue) => issue.key);
    expect(issues).toContain('adminUi.blog.seo.issues.titleTooShort');
    expect(issues).toContain('adminUi.blog.seo.issues.descriptionTooLong');
    expect(issues).toContain('adminUi.blog.seo.issues.derivedFromBody');
    expect(issues).toContain('adminUi.blog.seo.issues.previewTokenRecommended');

    const publicUrl = component.blogPublicUrl('ro');
    expect(publicUrl).toContain('/blog/coverage-target?lang=ro');

    const publishedOg = component.blogPublishedOgImageUrl('en');
    expect(publishedOg).toContain('/blog/posts/coverage-target/og.png?lang=en');

    component.blogPreviewToken = 'token with spaces';
    const previewOg = component.blogPreviewOgImageUrl('en');
    expect(previewOg).toContain('/blog/posts/coverage-target/og-preview.png?lang=en&token=token%20with%20spaces');

    component.blogPreviewToken = null;
    expect(component.blogPreviewOgImageUrl('en')).toBeNull();
  });
});
