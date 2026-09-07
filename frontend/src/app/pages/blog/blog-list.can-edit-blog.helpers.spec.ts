import { BlogListComponent } from './blog-list.component';

/** Golden WU tip orphan — canEditBlog. */
describe('BlogListComponent canEditBlog (golden WU)', () => {
  function bare(enabled: boolean): BlogListComponent {
    const cmp = Object.create(BlogListComponent.prototype) as BlogListComponent;
    Object.assign(cmp as any, { storefrontAdminMode: { enabled: () => enabled } });
    return cmp;
  }

  it('mirrors storefrontAdminMode.enabled()', () => {
    expect(bare(false).canEditBlog()).toBe(false);
    expect(bare(true).canEditBlog()).toBe(true);
  });
});
