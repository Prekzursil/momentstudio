import { BlogPostComponent } from './blog-post.component';

describe('BlogPostComponent canDelete / canFlag / canSubscribeToComments (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, {
      auth: {
        isAuthenticated: () => true,
        isAdmin: () => false,
        user: () => ({ id: 'u1', email_verified: true }),
      },
      ...overrides,
    });
    return cmp;
  }

  it('canDelete requires auth and author/admin', () => {
    const c = { is_deleted: false, author: { id: 'u1' } } as any;
    expect(createCmp().canDelete(c)).toBe(true);
    expect(createCmp({ auth: { isAuthenticated: () => false } }).canDelete(c)).toBe(false);
    expect(createCmp().canDelete({ ...c, is_deleted: true })).toBe(false);
  });

  it('canFlag requires other author and visible comment', () => {
    const c = { is_deleted: false, is_hidden: false, author: { id: 'u2' } } as any;
    expect(createCmp().canFlag(c)).toBe(true);
    expect(createCmp().canFlag({ ...c, author: { id: 'u1' } })).toBe(false);
  });

  it('canSubscribeToComments requires verified email', () => {
    expect(createCmp().canSubscribeToComments()).toBe(true);
    expect(
      createCmp({
        auth: { isAuthenticated: () => true, user: () => ({ id: 'u1', email_verified: false }) },
      }).canSubscribeToComments(),
    ).toBe(false);
  });
});
