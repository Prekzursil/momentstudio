import { BlogListComponent } from './blog-list.component';

/** Golden WU tip orphan — hasActiveFilters. */
describe('BlogListComponent hasActiveFilters (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): BlogListComponent {
    const cmp = Object.create(BlogListComponent.prototype) as BlogListComponent;
    Object.assign(cmp as any, {
      searchQuery: '',
      tagQuery: '',
      seriesQuery: '',
      ...overrides,
    });
    return cmp;
  }

  it('is true when search, tag, or series query is non-empty', () => {
    expect(bare().hasActiveFilters()).toBe(false);
    expect(bare({ searchQuery: ' ada ' }).hasActiveFilters()).toBe(true);
    expect(bare({ tagQuery: 'news' }).hasActiveFilters()).toBe(true);
    expect(bare({ seriesQuery: 'tips' }).hasActiveFilters()).toBe(true);
  });
});
