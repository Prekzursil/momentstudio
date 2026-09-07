import { BlogPostComponent } from './blog-post.component';

/** Golden WU tip orphan — coverImageClass. */
describe('BlogPostComponent coverImageClass (golden WU)', () => {
  function bare(): BlogPostComponent {
    return Object.create(BlogPostComponent.prototype) as BlogPostComponent;
  }

  it('uses contain vs cover classes', () => {
    const cmp = bare();
    expect(cmp.coverImageClass('contain')).toContain('object-contain');
    expect(cmp.coverImageClass('cover')).toContain('object-cover');
  });
});
