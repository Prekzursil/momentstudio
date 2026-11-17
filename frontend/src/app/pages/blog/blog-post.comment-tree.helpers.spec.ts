import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU blog-comment-tree — rootComments / replies / canReply. */
describe('BlogPostComponent comment-tree helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    (cmp as any).comments = signal([
      { id: '1', parent_id: null, is_deleted: false },
      { id: '2', parent_id: '1', is_deleted: false },
      { id: '3', parent_id: null, is_deleted: true },
    ]);
    (cmp as any).auth = { isAuthenticated: () => true };
    Object.assign(cmp as any, overrides);
    return cmp;
  }

  it('rootComments returns only top-level comments', () => {
    const cmp = createCmp();
    expect(cmp.rootComments().map((c: any) => c.id)).toEqual(['1', '3']);
  });

  it('replies returns children for a parent id', () => {
    const cmp = createCmp();
    expect(cmp.replies('1').map((c: any) => c.id)).toEqual(['2']);
    expect(cmp.replies('missing')).toEqual([]);
  });

  it('canReply requires auth and a non-deleted comment', () => {
    const cmp = createCmp();
    expect(cmp.canReply({ id: '1', is_deleted: false } as any)).toBe(true);
    expect(cmp.canReply({ id: '3', is_deleted: true } as any)).toBe(false);
    const anon = createCmp({ auth: { isAuthenticated: () => false } });
    expect(anon.canReply({ id: '1', is_deleted: false } as any)).toBe(false);
  });
});
