import { signal } from '@angular/core';
import { BlogPostComponent } from './blog-post.component';

describe('BlogPostComponent submitNewsletter gates (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(BlogPostComponent.prototype) as BlogPostComponent;
    Object.assign(cmp as any, {
      newsletterEmail: 'a@b.co',
      captchaEnabled: false,
      newsletterCaptchaToken: null,
      newsletterLoading: signal(false),
      newsletterSubscribed: signal(false),
      newsletterAlreadySubscribed: signal(false),
      toast: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') },
      translate: { instant: (k: string) => k },
      newsletter: { subscribe: jasmine.createSpy('subscribe') },
      ...overrides,
    });
    return cmp;
  }

  it('prevents default and no-ops on blank email', () => {
    const ev = { preventDefault: jasmine.createSpy('pd') } as any;
    createCmp({ newsletterEmail: '  ' }).submitNewsletter(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('requires captcha when enabled', () => {
    const cmp = createCmp({ captchaEnabled: true, newsletterCaptchaToken: null });
    cmp.submitNewsletter();
    expect((cmp as any).toast.error).toHaveBeenCalled();
    expect((cmp as any).newsletter.subscribe).not.toHaveBeenCalled();
  });

  it('starts subscribe when gates pass', () => {
    const cmp = createCmp();
    const sub = { subscribe: jasmine.createSpy('subscribe') };
    (cmp as any).newsletter.subscribe.and.returnValue(sub);
    cmp.submitNewsletter();
    expect((cmp as any).newsletterLoading()).toBe(true);
    expect((cmp as any).newsletter.subscribe).toHaveBeenCalledWith('a@b.co', {
      source: 'blog',
      captcha_token: null,
    });
    expect(sub.subscribe).toHaveBeenCalled();
  });
});
