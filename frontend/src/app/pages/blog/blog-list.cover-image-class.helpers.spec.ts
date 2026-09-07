import { BlogListComponent } from './blog-list.component';

/** Golden WU tip orphan — coverImageClass. */
describe('BlogListComponent coverImageClass (golden WU)', () => {
  function bare(): BlogListComponent {
    return Object.create(BlogListComponent.prototype) as BlogListComponent;
  }

  it('uses object-contain for contain fit and object-cover otherwise', () => {
    expect(bare().coverImageClass('contain')).toContain('object-contain');
    expect(bare().coverImageClass('cover')).toBe('object-cover');
    expect(bare().coverImageClass(null)).toBe('object-cover');
  });
});
