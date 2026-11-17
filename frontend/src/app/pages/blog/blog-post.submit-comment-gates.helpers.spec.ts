import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

/** Golden WU blog-submit-comment-gates — submitComment early-return arms. */
describe('BlogPostComponent submitComment gates (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    (cmp as any).slug = 'post-1';
    (cmp as any).auth = { isAuthenticated: () => true };
    (cmp as any).commentBody = 'hello';
    (cmp as any).captchaEnabled = false;
    (cmp as any).commentCaptchaToken = null;
    (cmp as any).submitting = signal(false);
    (cmp as any).replyTo = signal(null);
    (cmp as any).toast = { error: jasmine.createSpy('error') };
    (cmp as any).translate = { instant: (k: string) => k };
    (cmp as any).blog = { createComment: jasmine.createSpy('createComment') };
    Object.assign(cmp as any, overrides);
    return cmp;
  }

  it('submitComment no-ops without slug, auth, or body', () => {
    const ev = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    const noSlug = createCmp({ slug: '' });
    noSlug.submitComment(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect((noSlug as any).blog.createComment).not.toHaveBeenCalled();

    const anon = createCmp({ auth: { isAuthenticated: () => false } });
    anon.submitComment();
    expect((anon as any).blog.createComment).not.toHaveBeenCalled();

    const empty = createCmp({ commentBody: '   ' });
    empty.submitComment();
    expect((empty as any).blog.createComment).not.toHaveBeenCalled();
  });

  it('submitComment requires captcha token when captcha enabled', () => {
    const cmp = createCmp({ captchaEnabled: true, commentCaptchaToken: null });
    cmp.submitComment();
    expect((cmp as any).toast.error).toHaveBeenCalled();
    expect((cmp as any).blog.createComment).not.toHaveBeenCalled();
  });

  it('submitComment starts createComment when gates pass', () => {
    const cmp = createCmp();
    const sub = { subscribe: jasmine.createSpy('subscribe') };
    (cmp as any).blog.createComment.and.returnValue(sub);
    cmp.submitComment();
    expect((cmp as any).submitting()).toBe(true);
    expect((cmp as any).blog.createComment).toHaveBeenCalledWith('post-1', {
      body: 'hello',
      parent_id: null,
      captcha_token: null,
    });
    expect(sub.subscribe).toHaveBeenCalled();
  });
});
