import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU tip orphan — rootComments. */
describe('BlogPostComponent rootComments (golden WU)', () => {
  it('filters out replies with parent_id', () => {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, {
      comments: signal([
        { id: '1', parent_id: null },
        { id: '2', parent_id: '1' },
      ]),
    });
    expect(cmp.rootComments().map((c) => c.id)).toEqual(['1']);
  });
});
