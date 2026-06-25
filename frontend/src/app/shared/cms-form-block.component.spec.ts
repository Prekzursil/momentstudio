import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthService } from '../core/auth.service';
import { NewsletterService } from '../core/newsletter.service';
import { SupportService } from '../core/support.service';
import { appConfig } from '../core/app-config';
import { CmsFormBlockComponent } from './cms-form-block.component';
import type { PageFormBlock } from './page-blocks';

function block(overrides: Partial<PageFormBlock> = {}): PageFormBlock {
  return {
    key: 'f',
    type: 'form',
    enabled: true,
    form_type: 'contact',
    topic: 'contact',
    ...overrides,
  } as PageFormBlock;
}

describe('CmsFormBlockComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let support: jasmine.SpyObj<SupportService>;
  let newsletter: jasmine.SpyObj<NewsletterService>;
  const originalCaptchaKey = (appConfig as { captchaSiteKey?: string }).captchaSiteKey;

  function build(captchaKey = ''): CmsFormBlockComponent {
    (appConfig as { captchaSiteKey?: string }).captchaSiteKey = captchaKey;
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
    support = jasmine.createSpyObj<SupportService>('SupportService', ['submitContact']);
    newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']);
    auth.user.and.returnValue(null as never);

    TestBed.configureTestingModule({
      imports: [CmsFormBlockComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SupportService, useValue: support },
        { provide: NewsletterService, useValue: newsletter },
      ],
    });
    const fixture = TestBed.createComponent(CmsFormBlockComponent);
    return fixture.componentInstance;
  }

  afterEach(() => {
    (appConfig as { captchaSiteKey?: string }).captchaSiteKey = originalCaptchaKey;
  });

  it('initializes the topic from the block and resets when invalid', () => {
    const c = build();
    c.block = block({ topic: 'refund' });
    c.ngOnChanges();
    expect(c.formTopic).toBe('refund');

    c.block = block({ topic: 'bogus' as never });
    c.ngOnChanges();
    expect(c.formTopic).toBe('contact');
  });

  it('prefills name/email from the authenticated user', () => {
    const c = build();
    auth.user.and.returnValue({ email: ' me@test.io ', name: ' Me ' } as never);
    c.block = block();
    c.ngOnChanges();
    expect(c.formEmail).toBe('me@test.io');
    expect(c.formName).toBe('Me');
    expect(c.newsletterEmail).toBe('me@test.io');
  });

  it('does not prefill when there is no user or blank fields', () => {
    const c = build();
    auth.user.and.returnValue({ email: '', name: '' } as never);
    c.block = block();
    c.ngOnChanges();
    expect(c.formEmail).toBe('');
    expect(c.formName).toBe('');
  });

  it('submits a contact form and clears transient fields', () => {
    const c = build();
    support.submitContact.and.returnValue(of({ id: 'cs1' }) as never);
    c.block = block();
    c.ngOnChanges();
    c.formName = 'A';
    c.formEmail = 'a@b.c';
    c.formMessage = 'Hi';
    c.formOrderRef = 'ORD1';
    c.submitContact();
    expect(support.submitContact).toHaveBeenCalledWith(
      jasmine.objectContaining({
        name: 'A',
        email: 'a@b.c',
        message: 'Hi',
        order_reference: 'ORD1',
      }),
    );
    expect(c.contactSuccess()).toBeTrue();
    expect(c.formMessage).toBe('');
    expect(c.formOrderRef).toBe('');
  });

  it('sends a null order_reference when blank', () => {
    const c = build();
    support.submitContact.and.returnValue(of({ id: 'cs1' }) as never);
    c.block = block();
    c.formOrderRef = '   ';
    c.submitContact();
    expect(support.submitContact).toHaveBeenCalledWith(
      jasmine.objectContaining({ order_reference: null }),
    );
  });

  it('shows backend or fallback error on contact failure', () => {
    const c = build();
    support.submitContact.and.returnValue(throwError(() => ({ error: { detail: 'Nope' } })));
    c.block = block();
    c.submitContact();
    expect(c.contactError()).toBe('Nope');

    support.submitContact.and.returnValue(throwError(() => ({})));
    c.submitContact();
    expect(c.contactError()).toBe('contact.form.error');
  });

  it('guards contact submit while submitting and for non-contact blocks', () => {
    const c = build();
    c.block = block({ form_type: 'newsletter' });
    c.submitContact();
    expect(support.submitContact).not.toHaveBeenCalled();

    c.block = block();
    c.contactSubmitting.set(true);
    c.submitContact();
    expect(support.submitContact).not.toHaveBeenCalled();
  });

  it('defaults a missing form_type to contact for contact submit', () => {
    const c = build();
    support.submitContact.and.returnValue(of({ id: 'cs1' }) as never);
    c.block = block({ form_type: undefined as never });
    c.submitContact();
    expect(support.submitContact).toHaveBeenCalled();
  });

  it('requires a captcha token for contact when captcha is enabled', () => {
    const c = build('site-key');
    c.block = block();
    c.submitContact();
    expect(c.contactError()).toBe('auth.captchaRequired');
    expect(support.submitContact).not.toHaveBeenCalled();
  });

  it('subscribes to the newsletter and reports success', () => {
    const c = build();
    newsletter.subscribe.and.returnValue(of({ already_subscribed: false }) as never);
    c.block = block({ form_type: 'newsletter' });
    c.newsletterEmail = ' a@b.c ';
    c.submitNewsletter();
    expect(newsletter.subscribe).toHaveBeenCalledWith(
      'a@b.c',
      jasmine.objectContaining({ source: 'cms' }),
    );
    expect(c.newsletterSuccess()).toBeTrue();
  });

  it('reports already-subscribed newsletter responses', () => {
    const c = build();
    newsletter.subscribe.and.returnValue(of({ already_subscribed: true }) as never);
    c.block = block({ form_type: 'newsletter' });
    c.submitNewsletter();
    expect(c.newsletterAlreadySubscribed()).toBeTrue();
    expect(c.newsletterSuccess()).toBeFalse();
  });

  it('shows backend or fallback error on newsletter failure', () => {
    const c = build();
    newsletter.subscribe.and.returnValue(throwError(() => ({ error: { detail: 'Bad' } })));
    c.block = block({ form_type: 'newsletter' });
    c.submitNewsletter();
    expect(c.newsletterError()).toBe('Bad');

    newsletter.subscribe.and.returnValue(throwError(() => ({})));
    c.submitNewsletter();
    expect(c.newsletterError()).toBe('blog.newsletter.errorCopy');
  });

  it('guards newsletter submit while loading and for non-newsletter blocks', () => {
    const c = build();
    c.block = block();
    c.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();

    c.block = block({ form_type: 'newsletter' });
    c.newsletterLoading.set(true);
    c.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });

  it('defaults a missing form_type to contact, so newsletter submit is a no-op', () => {
    const c = build();
    c.block = block({ form_type: undefined as never });
    c.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });

  it('requires a captcha token for newsletter when captcha is enabled', () => {
    const c = build('site-key');
    c.block = block({ form_type: 'newsletter' });
    c.submitNewsletter();
    expect(c.newsletterError()).toBe('auth.captchaRequired');
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });

  it('resets captcha widgets through the view children', () => {
    const c = build('site-key');
    const contactReset = jasmine.createSpy('contactReset');
    const newsletterReset = jasmine.createSpy('newsletterReset');
    c.contactCaptcha = { reset: contactReset } as never;
    c.newsletterCaptcha = { reset: newsletterReset } as never;
    c.contactCaptchaToken = 'tok';
    support.submitContact.and.returnValue(of({ id: 'x' }) as never);
    c.block = block();
    c.submitContact();
    expect(contactReset).toHaveBeenCalled();

    c.newsletterCaptchaToken = 'tok2';
    newsletter.subscribe.and.returnValue(of({ already_subscribed: false }) as never);
    c.block = block({ form_type: 'newsletter' });
    c.submitNewsletter();
    expect(newsletterReset).toHaveBeenCalled();
  });
});
