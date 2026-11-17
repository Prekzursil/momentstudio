import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

describe('BlogPostComponent setCommentSort / goToCommentsPage (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, {
      commentSort: signal('newest'),
      commentPage: signal(2),
      commentsMeta: signal({ total_pages: 5 }),
      loadComments: jasmine.createSpy('loadComments'),
      ...overrides,
    });
    return cmp;
  }

  it('setCommentSort ignores invalid/same and reloads on change', () => {
    const cmp = createCmp();
    cmp.setCommentSort('nope' as any);
    cmp.setCommentSort('newest');
    expect((cmp as any).loadComments).not.toHaveBeenCalled();
    cmp.setCommentSort('top');
    expect((cmp as any).commentPage()).toBe(1);
    expect((cmp as any).loadComments).toHaveBeenCalledWith({ page: 1, sort: 'top' });
  });

  it('goToCommentsPage clamps and skips same page', () => {
    const cmp = createCmp();
    cmp.goToCommentsPage(2);
    expect((cmp as any).loadComments).not.toHaveBeenCalled();
    cmp.goToCommentsPage(99);
    expect((cmp as any).loadComments).toHaveBeenCalledWith({ page: 5 });
  });
});
