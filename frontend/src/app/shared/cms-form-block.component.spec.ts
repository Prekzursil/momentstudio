import { of, throwError } from 'rxjs';

import { CmsFormBlockComponent } from './cms-form-block.component';

describe('CmsFormBlockComponent', () => {
  function createComponent(): {
    component: CmsFormBlockComponent;
    support: jasmine.SpyObj<any>;
    newsletter: jasmine.SpyObj<any>;
  } {
    const auth = {
      user: jasmine.createSpy('user').and.returnValue({ email: ' user@example.com ', name: ' User Name ' })
    };
    const support = jasmine.createSpyObj('SupportService', ['submitContact']);
    const newsletter = jasmine.createSpyObj('NewsletterService', ['subscribe']);
    const translate = { instant: (key: string) => key };
    const component = new CmsFormBlockComponent(auth as any, support as any, newsletter as any, translate as any);
    component.block = { form_type: 'contact', topic: 'support' } as any;
    return { component, support, newsletter };
  }

  it('resets messages and prefills user data on changes', () => {
    const { component } = createComponent();
    component.contactError.set('boom');
    component.newsletterError.set('boom');
    component.formTopic = 'refund';

    component.ngOnChanges();

    expect(component.formEmail).toBe('user@example.com');
    expect(component.newsletterEmail).toBe('user@example.com');
    expect(component.formName).toBe('User Name');
    expect(component.formTopic).toBe('support');
    expect(component.contactError()).toBe('');
    expect(component.newsletterError()).toBe('');
  });

  it('submits contact successfully and resets captcha state', () => {
    const { component, support } = createComponent();
    component.captchaEnabled = true;
    component.contactCaptchaToken = 'token-1';
    component.contactCaptcha = { reset: jasmine.createSpy('reset') } as any;
    component.formTopic = 'contact';
    component.formName = '  John  ';
    component.formEmail = '  john@example.com  ';
    component.formMessage = '  Hello  ';
    component.formOrderRef = '  REF-1  ';
    support.submitContact.and.returnValue(of({ ok: true }));

    component.submitContact();

    expect(support.submitContact).toHaveBeenCalledWith(
      jasmine.objectContaining({
        topic: 'contact',
        name: 'John',
        email: 'john@example.com',
        message: 'Hello',
        order_reference: 'REF-1',
        captcha_token: 'token-1'
      })
    );
    expect(component.contactSuccess()).toBeTrue();
    expect(component.contactSubmitting()).toBeFalse();
    expect(component.contactCaptchaToken).toBeNull();
    expect(component.contactCaptcha?.reset).toHaveBeenCalled();
  });

  it('handles contact captcha requirement and API errors', () => {
    const { component, support } = createComponent();
    component.captchaEnabled = true;
    component.contactCaptchaToken = null;

    component.submitContact();
    expect(component.contactError()).toBe('auth.captchaRequired');
    expect(support.submitContact).not.toHaveBeenCalled();

    component.captchaEnabled = false;
    component.contactCaptcha = { reset: jasmine.createSpy('reset') } as any;
    support.submitContact.and.returnValue(throwError(() => ({ error: { detail: 'bad request' } })));

    component.submitContact();

    expect(component.contactError()).toBe('bad request');
    expect(component.contactSubmitting()).toBeFalse();
    expect(component.contactCaptcha?.reset).toHaveBeenCalled();
  });

  it('submits newsletter with already-subscribed and success/error branches', () => {
    const { component, newsletter } = createComponent();
    component.block = { form_type: 'newsletter' } as any;
    component.newsletterEmail = '  news@example.com  ';
    component.newsletterCaptcha = { reset: jasmine.createSpy('reset') } as any;
    component.captchaEnabled = true;

    component.newsletterCaptchaToken = null;
    component.submitNewsletter();
    expect(component.newsletterError()).toBe('auth.captchaRequired');

    component.newsletterCaptchaToken = 'n-token';
    newsletter.subscribe.and.returnValue(of({ already_subscribed: true }));
    component.submitNewsletter();
    expect(newsletter.subscribe).toHaveBeenCalledWith('news@example.com', { source: 'cms', captcha_token: 'n-token' });
    expect(component.newsletterAlreadySubscribed()).toBeTrue();
    expect(component.newsletterSuccess()).toBeFalse();

    component.newsletterCaptchaToken = 'n-token-2';
    newsletter.subscribe.and.returnValue(of({ already_subscribed: false }));
    component.submitNewsletter();
    expect(component.newsletterSuccess()).toBeTrue();

    component.newsletterCaptchaToken = 'n-token-3';
    newsletter.subscribe.and.returnValue(throwError(() => ({ error: { detail: 'cannot subscribe' } })));
    component.submitNewsletter();
    expect(component.newsletterError()).toBe('cannot subscribe');
    expect(component.newsletterLoading()).toBeFalse();
    expect(component.newsletterCaptcha?.reset).toHaveBeenCalled();
  });

  it('does not submit when loading or wrong block type', () => {
    const { component, support, newsletter } = createComponent();
    component.contactSubmitting.set(true);
    component.submitContact();
    expect(support.submitContact).not.toHaveBeenCalled();

    component.block = { form_type: 'newsletter' } as any;
    component.contactSubmitting.set(false);
    component.submitContact();
    expect(support.submitContact).not.toHaveBeenCalled();

    component.newsletterLoading.set(true);
    component.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();

    component.newsletterLoading.set(false);
    component.block = { form_type: 'contact' } as any;
    component.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });
});
